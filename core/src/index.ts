import { ethers } from 'ethers';
import { Logger } from './utils/Logger';
import { ConfigManager } from './config/ConfigManager';
import { FourMemeBundler } from './bundler/FourMemeBundler';
import { MEVProtection } from './mev-protection/MEVProtection';
import { GasOptimizer } from './gas-optimizer/GasOptimizer';
import { BatchProcessor } from './batch-processor/BatchProcessor';
import { FourMemeAPI } from './fourmeme/FourMemeAPI';
import { RiskManager } from './risk/RiskManager';
import { MonitoringService } from './monitoring/MonitoringService';
import { DatabaseManager } from './utils/DatabaseManager';
import { RedisManager } from './utils/RedisManager';

export class FourMemeBundlerMain {
  private logger: Logger;
  private config: ConfigManager;
  private bundler: FourMemeBundler;
  private mevProtection: MEVProtection;
  private gasOptimizer: GasOptimizer;
  private batchProcessor: BatchProcessor;
  private fourMemeAPI: FourMemeAPI;
  private riskManager: RiskManager;
  private monitoringService: MonitoringService;
  private databaseManager: DatabaseManager;
  private redisManager: RedisManager;
  private provider: ethers.JsonRpcProvider;
  private privateProvider?: ethers.JsonRpcProvider;
  private isRunning: boolean = false;

  constructor() {
    this.logger = new Logger('FourMemeBundlerMain');
    this.config = new ConfigManager();
    this.databaseManager = new DatabaseManager();
    this.redisManager = new RedisManager();
    
    // Initialize blockchain provider
    this.provider = new ethers.JsonRpcProvider(this.config.get('BSC_RPC_URL'));
    
    // Initialize private provider if configured
    const privateRpcUrl = this.config.get('PRIVATE_RPC_URL');
    if (privateRpcUrl) {
      this.privateProvider = new ethers.JsonRpcProvider(privateRpcUrl);
    }
    
    // Initialize core services
    this.mevProtection = new MEVProtection(this.provider, this.config);
    this.gasOptimizer = new GasOptimizer(this.provider, this.config);
    this.batchProcessor = new BatchProcessor(this.provider, this.config);
    this.fourMemeAPI = new FourMemeAPI(this.config);
    this.riskManager = new RiskManager(this.config);
    this.monitoringService = new MonitoringService(this.provider, this.config);
    
    // Initialize bundler
    this.bundler = new FourMemeBundler(
      this.provider,
      this.mevProtection,
      this.gasOptimizer,
      this.batchProcessor,
      this.fourMemeAPI,
      this.riskManager,
      this.monitoringService,
      this.config
    );
  }

  public async initialize(): Promise<void> {
    try {
      this.logger.info('🚀 Initializing Four.Meme Bundler...');

      // Validate configuration
      if (!this.config.validate()) {
        throw new Error('Configuration validation failed');
      }

      // Initialize database connections
      await this.databaseManager.connect();
      await this.redisManager.connect();

      // Initialize MEV protection
      await this.mevProtection.initialize();
      
      // Initialize gas optimizer
      await this.gasOptimizer.initialize();
      
      // Initialize batch processor
      await this.batchProcessor.initialize();
      
      // Initialize Four.Meme API
      await this.fourMemeAPI.initialize();
      
      // Initialize risk manager
      await this.riskManager.initialize();
      
      // Initialize monitoring service
      await this.monitoringService.initialize();
      
      // Initialize bundler
      await this.bundler.initialize();

      this.logger.info('✅ Four.Meme Bundler initialization completed successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Four.Meme Bundler:', error);
      throw error;
    }
  }

  public async start(): Promise<void> {
    try {
      if (this.isRunning) {
        this.logger.warn('Four.Meme Bundler is already running');
        return;
      }

      this.logger.info('🎯 Starting Four.Meme Bundler...');
      this.isRunning = true;

      // Start bundler
      await this.bundler.start();

      // Set up event listeners
      this.setupEventListeners();

      this.logger.info('✅ Four.Meme Bundler started successfully');
    } catch (error) {
      this.logger.error('❌ Failed to start Four.Meme Bundler:', error);
      this.isRunning = false;
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      if (!this.isRunning) {
        this.logger.warn('Four.Meme Bundler is not running');
        return;
      }

      this.logger.info('🛑 Stopping Four.Meme Bundler...');
      this.isRunning = false;

      // Stop bundler
      await this.bundler.stop();

      this.logger.info('✅ Four.Meme Bundler stopped successfully');
    } catch (error) {
      this.logger.error('❌ Error stopping Four.Meme Bundler:', error);
      throw error;
    }
  }

  public async restart(): Promise<void> {
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    await this.start();
  }

  public async createTokenBundle(tokenParams: any): Promise<string> {
    try {
      this.logger.info(`📦 Creating token bundle for: ${tokenParams.symbol}`);
      
      const bundleId = await this.bundler.createLaunchBundle(tokenParams);
      
      this.logger.info(`✅ Token bundle ${bundleId} created successfully`);
      
      return bundleId;
    } catch (error) {
      this.logger.error('❌ Error creating token bundle:', error);
      throw error;
    }
  }

  public async executeTokenBundle(bundleId: string): Promise<any> {
    try {
      this.logger.info(`🚀 Executing token bundle: ${bundleId}`);
      
      const result = await this.bundler.executeLaunchBundle(bundleId);
      
      this.logger.info(`✅ Token bundle ${bundleId} executed: ${result.successfulBuys}/${result.totalBuys} buys successful`);
      
      return result;
    } catch (error) {
      this.logger.error(`❌ Error executing token bundle ${bundleId}:`, error);
      throw error;
    }
  }

  private setupEventListeners(): void {
    // Bundle execution events
    this.bundler.on('bundleExecuted', (result) => {
      this.logger.info(`📊 Bundle ${result.bundleId} executed: ${result.successfulBuys}/${result.totalBuys} successful`);
      
      // Handle bundle result
      this.handleBundleResult(result);
    });

    // Risk management events
    this.riskManager.on('riskAlert', (riskData) => {
      this.logger.warn('⚠️ Risk alert:', riskData);
      
      // Handle risk alerts
      this.handleRiskAlert(riskData);
    });

    // Gas optimization events
    this.gasOptimizer.on('gasPriceUpdate', (gasData) => {
      this.logger.info(`⛽ Gas price updated: ${ethers.formatUnits(gasData.gasPrice, 'gwei')} gwei`);
    });

    // Batch processing events
    this.batchProcessor.on('batchCompleted', (result) => {
      this.logger.info(`📦 Batch ${result.batchId} completed: ${result.successfulTxs}/${result.transactions.length} successful`);
    });

    // Error handling
    process.on('uncaughtException', (error) => {
      this.logger.error('💥 Uncaught Exception:', error);
      this.stop();
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    });
  }

  private handleBundleResult(result: any): void {
    try {
      // Log bundle statistics
      this.logger.info(`📊 Bundle Statistics:`);
      this.logger.info(`  - Total Buys: ${result.totalBuys}`);
      this.logger.info(`  - Successful Buys: ${result.successfulBuys}`);
      this.logger.info(`  - Failed Buys: ${result.failedBuys}`);
      this.logger.info(`  - Success Rate: ${((result.successfulBuys / result.totalBuys) * 100).toFixed(2)}%`);
      this.logger.info(`  - Total Gas Used: ${result.totalGasUsed.toString()}`);
      this.logger.info(`  - Execution Time: ${result.executionTime}ms`);
      
      // Store result in database
      this.storeBundleResult(result);
      
      // Update monitoring metrics
      this.updateMonitoringMetrics(result);
      
    } catch (error) {
      this.logger.error('Error handling bundle result:', error);
    }
  }

  private handleRiskAlert(riskData: any): void {
    try {
      // Handle risk alerts
      if (riskData.level === 'HIGH') {
        this.logger.warn('🚨 High risk detected, reducing bundle size');
        // Reduce bundle size or stop processing
      } else if (riskData.level === 'CRITICAL') {
        this.logger.error('💥 Critical risk detected, stopping all bundles');
        this.bundler.stopAllSnipes();
      }
    } catch (error) {
      this.logger.error('Error handling risk alert:', error);
    }
  }

  private async storeBundleResult(result: any): Promise<void> {
    try {
      // Store bundle result in database
      // Implementation would depend on database schema
      this.logger.debug('Storing bundle result in database');
    } catch (error) {
      this.logger.error('Error storing bundle result:', error);
    }
  }

  private updateMonitoringMetrics(result: any): void {
    try {
      // Update monitoring metrics
      // Implementation would depend on monitoring system
      this.logger.debug('Updating monitoring metrics');
    } catch (error) {
      this.logger.error('Error updating monitoring metrics:', error);
    }
  }

  public getStatus(): any {
    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      bundlerStatus: this.bundler.getStatus(),
      mevProtection: this.mevProtection.isProtectionEnabled(),
      gasOptimizer: this.gasOptimizer.getGasConfig(),
      batchProcessor: this.batchProcessor.getStatus(),
      fourMemeAPI: this.fourMemeAPI.isConnected(),
      riskManager: this.riskManager.getCurrentRiskLevel(),
      privateProvider: !!this.privateProvider
    };
  }

  public getBundleResults(): Map<string, any> {
    return this.bundler.getBundleResults();
  }

  public getActiveBundles(): Map<string, any> {
    return this.bundler.getActiveBundles();
  }

  public getBuyWallets(): ethers.Wallet[] {
    return this.bundler.getBuyWallets();
  }
}

// Export for use in other modules
export default FourMemeBundlerMain;
