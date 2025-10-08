import { ethers } from 'ethers';
import { Logger } from '../utils/Logger';
import { ConfigManager } from '../config/ConfigManager';

export interface BatchProcessorConfig {
  enabled: boolean;
  maxBatchSize: number;
  batchTimeout: number;
  parallelBatches: number;
  retryAttempts: number;
  retryDelay: number;
  gasPriceIncrement: number;
  priorityFeeIncrement: number;
}

export interface BatchTransaction {
  id: string;
  transaction: ethers.TransactionRequest;
  wallet: ethers.Wallet;
  nonce: number;
  gasPrice: bigint;
  priorityFee: bigint;
  maxFeePerGas: bigint;
  status: 'PENDING' | 'SENT' | 'CONFIRMED' | 'FAILED' | 'RETRY';
  retryCount: number;
  timestamp: number;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
}

export interface BatchResult {
  batchId: string;
  transactions: BatchTransaction[];
  successfulTxs: number;
  failedTxs: number;
  totalGasUsed: bigint;
  totalGasPrice: bigint;
  executionTime: number;
  success: boolean;
  error?: string;
}

export interface BatchQueue {
  id: string;
  transactions: BatchTransaction[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: number;
  timeout: number;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
}

export class BatchProcessor {
  private logger: Logger;
  private config: ConfigManager;
  private provider: ethers.JsonRpcProvider;
  private batchConfig: BatchProcessorConfig;
  private batchQueue: BatchQueue[] = [];
  private activeBatches: Map<string, BatchResult> = new Map();
  private isProcessing: boolean = false;
  private batchCounter: number = 0;

  constructor(provider: ethers.JsonRpcProvider, config: ConfigManager) {
    this.logger = new Logger('BatchProcessor');
    this.config = config;
    this.provider = provider;
    this.batchConfig = this.loadBatchConfig();
  }

  public async initialize(): Promise<void> {
    try {
      this.logger.info('🔧 Initializing Batch Processor...');
      
      // Test provider connection
      await this.provider.getBlockNumber();
      
      this.logger.info('✅ Batch Processor initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Batch Processor:', error);
      throw error;
    }
  }

  public async processBatch(transactions: BatchTransaction[]): Promise<BatchResult> {
    try {
      this.logger.info(`📦 Processing batch of ${transactions.length} transactions`);

      const batchId = this.generateBatchId();
      const startTime = Date.now();
      
      // Validate transactions
      const validTransactions = await this.validateTransactions(transactions);
      
      if (validTransactions.length === 0) {
        throw new Error('No valid transactions in batch');
      }

      // Process transactions in parallel batches
      const results = await this.processTransactionsInBatches(validTransactions);
      
      // Calculate batch result
      const batchResult: BatchResult = {
        batchId,
        transactions: validTransactions,
        successfulTxs: results.successfulTxs,
        failedTxs: results.failedTxs,
        totalGasUsed: results.totalGasUsed,
        totalGasPrice: results.totalGasPrice,
        executionTime: Date.now() - startTime,
        success: results.successfulTxs > 0
      };

      // Store result
      this.activeBatches.set(batchId, batchResult);
      
      this.logger.info(`✅ Batch ${batchId} processed: ${results.successfulTxs}/${validTransactions.length} successful`);
      
      return batchResult;
    } catch (error) {
      this.logger.error('❌ Error processing batch:', error);
      throw error;
    }
  }

  public async queueBatch(
    transactions: BatchTransaction[],
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'
  ): Promise<string> {
    try {
      this.logger.info(`📋 Queueing batch of ${transactions.length} transactions`);

      const batchId = this.generateBatchId();
      const timeout = Date.now() + this.batchConfig.batchTimeout;
      
      const batchQueue: BatchQueue = {
        id: batchId,
        transactions,
        priority,
        createdAt: Date.now(),
        timeout,
        status: 'QUEUED'
      };

      // Add to queue
      this.batchQueue.push(batchQueue);
      
      // Sort by priority
      this.sortBatchQueue();
      
      // Start processing if not already running
      if (!this.isProcessing) {
        this.startBatchProcessing();
      }
      
      this.logger.info(`✅ Batch ${batchId} queued with ${priority} priority`);
      
      return batchId;
    } catch (error) {
      this.logger.error('❌ Error queueing batch:', error);
      throw error;
    }
  }

  private async validateTransactions(transactions: BatchTransaction[]): Promise<BatchTransaction[]> {
    try {
      const validTransactions: BatchTransaction[] = [];
      
      for (const tx of transactions) {
        try {
          // Validate transaction
          if (!tx.transaction.to || !tx.wallet) {
            this.logger.warn(`Invalid transaction ${tx.id}: missing to address or wallet`);
            continue;
          }

          // Check wallet balance
          const balance = await this.provider.getBalance(tx.wallet.address);
          const gasCost = tx.gasPrice * BigInt(tx.transaction.gasLimit || 200000);
          
          if (balance < gasCost + (tx.transaction.value || BigInt(0))) {
            this.logger.warn(`Insufficient balance for transaction ${tx.id}`);
            continue;
          }

          // Update nonce if needed
          if (tx.nonce === 0) {
            tx.nonce = await this.provider.getTransactionCount(tx.wallet.address, 'pending');
          }

          validTransactions.push(tx);
        } catch (error) {
          this.logger.error(`Error validating transaction ${tx.id}:`, error);
        }
      }
      
      return validTransactions;
    } catch (error) {
      this.logger.error('Error validating transactions:', error);
      return [];
    }
  }

  private async processTransactionsInBatches(transactions: BatchTransaction[]): Promise<any> {
    try {
      let successfulTxs = 0;
      let failedTxs = 0;
      let totalGasUsed = BigInt(0);
      let totalGasPrice = BigInt(0);
      
      // Process in parallel batches
      const batchSize = this.batchConfig.maxBatchSize;
      const parallelBatches = this.batchConfig.parallelBatches;
      
      for (let i = 0; i < transactions.length; i += batchSize * parallelBatches) {
        const batchGroup = transactions.slice(i, i + batchSize * parallelBatches);
        
        // Create parallel batches
        const batches: Promise<any>[] = [];
        
        for (let j = 0; j < batchGroup.length; j += batchSize) {
          const batch = batchGroup.slice(j, j + batchSize);
          batches.push(this.processTransactionBatch(batch));
        }
        
        // Wait for all batches in this group to complete
        const results = await Promise.allSettled(batches);
        
        // Process results
        for (const result of results) {
          if (result.status === 'fulfilled') {
            successfulTxs += result.value.successfulTxs;
            failedTxs += result.value.failedTxs;
            totalGasUsed += result.value.totalGasUsed;
            totalGasPrice += result.value.totalGasPrice;
          } else {
            failedTxs += batchSize; // Assume all failed if batch failed
          }
        }
        
        // Small delay between batch groups
        if (i + batchSize * parallelBatches < transactions.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      return {
        successfulTxs,
        failedTxs,
        totalGasUsed,
        totalGasPrice
      };
    } catch (error) {
      this.logger.error('Error processing transactions in batches:', error);
      throw error;
    }
  }

  private async processTransactionBatch(transactions: BatchTransaction[]): Promise<any> {
    try {
      let successfulTxs = 0;
      let failedTxs = 0;
      let totalGasUsed = BigInt(0);
      let totalGasPrice = BigInt(0);
      
      // Process transactions in parallel
      const promises = transactions.map(async (tx) => {
        try {
          // Execute transaction
          const result = await this.executeTransaction(tx);
          
          if (result.success) {
            successfulTxs++;
            totalGasUsed += result.gasUsed || BigInt(0);
            totalGasPrice += result.gasPrice || BigInt(0);
            tx.status = 'CONFIRMED';
            tx.txHash = result.txHash;
            tx.blockNumber = result.blockNumber;
            tx.gasUsed = result.gasUsed;
          } else {
            failedTxs++;
            tx.status = 'FAILED';
            
            // Retry if configured
            if (tx.retryCount < this.batchConfig.retryAttempts) {
              await this.retryTransaction(tx);
            }
          }
        } catch (error) {
          this.logger.error(`Error processing transaction ${tx.id}:`, error);
          failedTxs++;
          tx.status = 'FAILED';
        }
      });
      
      // Wait for all transactions to complete
      await Promise.allSettled(promises);
      
      return {
        successfulTxs,
        failedTxs,
        totalGasUsed,
        totalGasPrice
      };
    } catch (error) {
      this.logger.error('Error processing transaction batch:', error);
      throw error;
    }
  }

  private async executeTransaction(tx: BatchTransaction): Promise<any> {
    try {
      // Prepare transaction
      const transaction = {
        ...tx.transaction,
        gasPrice: tx.gasPrice,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.priorityFee,
        nonce: tx.nonce
      };
      
      // Execute transaction
      const response = await tx.wallet.sendTransaction(transaction);
      tx.status = 'SENT';
      tx.txHash = response.hash;
      
      // Wait for confirmation
      const receipt = await response.wait();
      
      if (receipt.status === 1) {
        return {
          success: true,
          txHash: response.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          gasPrice: receipt.gasPrice
        };
      } else {
        return { success: false };
      }
    } catch (error) {
      this.logger.error(`Error executing transaction ${tx.id}:`, error);
      return { success: false, error: error.message };
    }
  }

  private async retryTransaction(tx: BatchTransaction): Promise<void> {
    try {
      tx.retryCount++;
      tx.status = 'RETRY';
      
      // Increment gas price for retry
      tx.gasPrice = BigInt(Math.floor(Number(tx.gasPrice) * this.batchConfig.gasPriceIncrement));
      tx.priorityFee = BigInt(Math.floor(Number(tx.priorityFee) * this.batchConfig.priorityFeeIncrement));
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, this.batchConfig.retryDelay));
      
      // Retry transaction
      const result = await this.executeTransaction(tx);
      
      if (result.success) {
        tx.status = 'CONFIRMED';
        tx.txHash = result.txHash;
        tx.blockNumber = result.blockNumber;
        tx.gasUsed = result.gasUsed;
      } else {
        tx.status = 'FAILED';
      }
    } catch (error) {
      this.logger.error(`Error retrying transaction ${tx.id}:`, error);
      tx.status = 'FAILED';
    }
  }

  private startBatchProcessing(): void {
    if (this.isProcessing) {
      return;
    }
    
    this.isProcessing = true;
    
    // Process queue
    setInterval(async () => {
      try {
        await this.processBatchQueue();
      } catch (error) {
        this.logger.error('Error processing batch queue:', error);
      }
    }, 1000); // Process every second
  }

  private async processBatchQueue(): Promise<void> {
    try {
      if (this.batchQueue.length === 0) {
        return;
      }
      
      // Get next batch to process
      const batch = this.batchQueue.shift();
      if (!batch) {
        return;
      }
      
      // Check timeout
      if (Date.now() > batch.timeout) {
        batch.status = 'TIMEOUT';
        this.logger.warn(`Batch ${batch.id} timed out`);
        return;
      }
      
      batch.status = 'PROCESSING';
      
      try {
        // Process batch
        const result = await this.processBatch(batch.transactions);
        
        batch.status = result.success ? 'COMPLETED' : 'FAILED';
        
        this.logger.info(`Batch ${batch.id} processed: ${result.successfulTxs}/${result.transactions.length} successful`);
      } catch (error) {
        this.logger.error(`Error processing batch ${batch.id}:`, error);
        batch.status = 'FAILED';
      }
    } catch (error) {
      this.logger.error('Error processing batch queue:', error);
    }
  }

  private sortBatchQueue(): void {
    this.batchQueue.sort((a, b) => {
      const priorityOrder = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      return a.createdAt - b.createdAt; // FIFO for same priority
    });
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${++this.batchCounter}`;
  }

  private loadBatchConfig(): BatchProcessorConfig {
    return {
      enabled: this.config.get('BATCH_PROCESSING_ENABLED', true),
      maxBatchSize: this.config.get('MAX_BATCH_SIZE', 10),
      batchTimeout: this.config.get('BATCH_TIMEOUT', 300000),
      parallelBatches: this.config.get('PARALLEL_BATCHES', 3),
      retryAttempts: this.config.get('RETRY_ATTEMPTS', 3),
      retryDelay: this.config.get('RETRY_DELAY', 1000),
      gasPriceIncrement: this.config.get('GAS_PRICE_INCREMENT', 1.1),
      priorityFeeIncrement: this.config.get('PRIORITY_FEE_INCREMENT', 1.1)
    };
  }

  public getBatchQueue(): BatchQueue[] {
    return [...this.batchQueue];
  }

  public getActiveBatches(): Map<string, BatchResult> {
    return new Map(this.activeBatches);
  }

  public getStatus(): any {
    return {
      isProcessing: this.isProcessing,
      queueLength: this.batchQueue.length,
      activeBatches: this.activeBatches.size,
      totalBatches: this.batchCounter
    };
  }

  public async clearQueue(): Promise<void> {
    this.batchQueue = [];
    this.logger.info('Batch queue cleared');
  }

  public async stopProcessing(): Promise<void> {
    this.isProcessing = false;
    this.logger.info('Batch processing stopped');
  }
}
