import { ethers } from 'ethers';
import { Logger } from '../utils/Logger';
import { ConfigManager } from '../config/ConfigManager';

export interface GasOptimizationConfig {
  enabled: boolean;
  dynamicPricing: boolean;
  gasPriceBuffer: number;
  priorityFeeBuffer: number;
  maxGasPrice: number;
  minGasPrice: number;
  gasPriceHistorySize: number;
  networkCongestionThreshold: number;
  validatorTipsEnabled: boolean;
  validatorTipAmount: bigint;
}

export interface GasPriceData {
  gasPrice: bigint;
  priorityFee: bigint;
  maxFeePerGas: bigint;
  confidence: number;
  networkCongestion: number;
  recommendation: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: number;
}

export interface BundleGasOptimization {
  launchGasPrice: bigint;
  buyGasPrice: bigint;
  priorityFee: bigint;
  totalGasEstimate: bigint;
  totalGasCost: bigint;
  optimizationStrategy: string;
  validatorTips: bigint;
}

export class GasOptimizer {
  private logger: Logger;
  private config: ConfigManager;
  private provider: ethers.JsonRpcProvider;
  private gasConfig: GasOptimizationConfig;
  private gasPriceHistory: GasPriceData[] = [];
  private isInitialized: boolean = false;

  constructor(provider: ethers.JsonRpcProvider, config: ConfigManager) {
    this.logger = new Logger('GasOptimizer');
    this.config = config;
    this.provider = provider;
    this.gasConfig = this.loadGasConfig();
  }

  public async initialize(): Promise<void> {
    try {
      this.logger.info('🔧 Initializing Gas Optimizer...');
      
      // Load initial gas price history
      await this.updateGasPriceHistory();
      
      this.isInitialized = true;
      this.logger.info('✅ Gas Optimizer initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Gas Optimizer:', error);
      throw error;
    }
  }

  public async getOptimalGasPrice(): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();
      const currentGasPrice = feeData.gasPrice || BigInt(0);
      
      if (!this.gasConfig.enabled) {
        return currentGasPrice;
      }
      
      // Calculate optimal gas price based on network conditions
      const optimalGasPrice = await this.calculateOptimalGasPrice(currentGasPrice);
      
      this.logger.info(`⛽ Optimal gas price: ${ethers.formatUnits(optimalGasPrice, 'gwei')} gwei`);
      
      return optimalGasPrice;
    } catch (error) {
      this.logger.error('Error getting optimal gas price:', error);
      return BigInt(5 * 1e9); // Fallback to 5 gwei
    }
  }

  public async getOptimalPriorityFee(): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();
      const currentPriorityFee = feeData.maxPriorityFeePerGas || BigInt(0);
      
      if (!this.gasConfig.enabled) {
        return currentPriorityFee;
      }
      
      // Calculate optimal priority fee
      const optimalPriorityFee = await this.calculateOptimalPriorityFee(currentPriorityFee);
      
      return optimalPriorityFee;
    } catch (error) {
      this.logger.error('Error getting optimal priority fee:', error);
      return BigInt(1 * 1e9); // Fallback to 1 gwei
    }
  }

  public async optimizeBundleGas(
    launchGasLimit: bigint,
    buyGasLimit: bigint,
    walletCount: number
  ): Promise<BundleGasOptimization> {
    try {
      this.logger.info(`🔧 Optimizing gas for bundle: ${walletCount} wallets`);
      
      // Get current network conditions
      const networkCongestion = await this.getNetworkCongestion();
      
      // Calculate gas prices based on urgency
      const launchGasPrice = await this.getUrgentGasPrice('LAUNCH');
      const buyGasPrice = await this.getUrgentGasPrice('BUY');
      const priorityFee = await this.getOptimalPriorityFee();
      
      // Calculate total gas estimates
      const totalGasEstimate = launchGasLimit + (buyGasLimit * BigInt(walletCount));
      
      // Calculate total gas cost
      const totalGasCost = (launchGasPrice * launchGasLimit) + (buyGasPrice * buyGasLimit * BigInt(walletCount));
      
      // Calculate validator tips
      const validatorTips = this.gasConfig.validatorTipsEnabled 
        ? this.gasConfig.validatorTipAmount * BigInt(walletCount + 1) // +1 for launch tx
        : BigInt(0);
      
      // Determine optimization strategy
      const optimizationStrategy = this.determineOptimizationStrategy(networkCongestion, walletCount);
      
      const optimization: BundleGasOptimization = {
        launchGasPrice,
        buyGasPrice,
        priorityFee,
        totalGasEstimate,
        totalGasCost,
        optimizationStrategy,
        validatorTips
      };
      
      this.logger.info(`✅ Bundle gas optimized: ${ethers.formatEther(totalGasCost)} BNB total cost`);
      
      return optimization;
    } catch (error) {
      this.logger.error('Error optimizing bundle gas:', error);
      throw error;
    }
  }

  public async getUrgentGasPrice(type: 'LAUNCH' | 'BUY'): Promise<bigint> {
    try {
      const baseGasPrice = await this.getOptimalGasPrice();
      const networkCongestion = await this.getNetworkCongestion();
      
      let urgencyMultiplier = 1.0;
      
      // Launch transactions need higher priority
      if (type === 'LAUNCH') {
        urgencyMultiplier = 1.5; // 50% higher for launch
      } else {
        urgencyMultiplier = 1.2; // 20% higher for buys
      }
      
      // Adjust based on network congestion
      if (networkCongestion > 0.8) {
        urgencyMultiplier *= 1.3; // 30% higher in high congestion
      } else if (networkCongestion > 0.6) {
        urgencyMultiplier *= 1.1; // 10% higher in medium congestion
      }
      
      const urgentGasPrice = BigInt(Math.floor(Number(baseGasPrice) * urgencyMultiplier));
      
      // Ensure within limits
      const maxGasPrice = BigInt(this.gasConfig.maxGasPrice * 1e9);
      const minGasPrice = BigInt(this.gasConfig.minGasPrice * 1e9);
      
      return urgentGasPrice > maxGasPrice ? maxGasPrice : 
             urgentGasPrice < minGasPrice ? minGasPrice : urgentGasPrice;
    } catch (error) {
      this.logger.error('Error getting urgent gas price:', error);
      return BigInt(10 * 1e9); // Fallback to 10 gwei
    }
  }

  private async calculateOptimalGasPrice(currentGasPrice: bigint): Promise<bigint> {
    try {
      // Get network congestion level
      const congestionLevel = await this.getNetworkCongestion();
      
      // Calculate optimal gas price based on congestion
      let multiplier = 1.0;
      
      if (congestionLevel > 0.8) {
        multiplier = 1.5; // High congestion - increase gas price
      } else if (congestionLevel > 0.6) {
        multiplier = 1.2; // Medium congestion - slight increase
      } else if (congestionLevel < 0.3) {
        multiplier = 0.9; // Low congestion - can use lower gas price
      }
      
      const optimalGasPrice = BigInt(Math.floor(Number(currentGasPrice) * multiplier));
      
      // Apply buffer
      const bufferedGasPrice = BigInt(Math.floor(Number(optimalGasPrice) * this.gasConfig.gasPriceBuffer));
      
      // Ensure minimum gas price
      const minGasPrice = BigInt(this.gasConfig.minGasPrice * 1e9);
      return bufferedGasPrice > minGasPrice ? bufferedGasPrice : minGasPrice;
      
    } catch (error) {
      this.logger.error('Error calculating optimal gas price:', error);
      return currentGasPrice;
    }
  }

  private async calculateOptimalPriorityFee(currentPriorityFee: bigint): Promise<bigint> {
    try {
      const networkCongestion = await this.getNetworkCongestion();
      
      let multiplier = 1.0;
      
      if (networkCongestion > 0.8) {
        multiplier = 2.0; // High congestion - double priority fee
      } else if (networkCongestion > 0.6) {
        multiplier = 1.5; // Medium congestion - 50% increase
      } else if (networkCongestion < 0.3) {
        multiplier = 0.8; // Low congestion - can use lower priority fee
      }
      
      const optimalPriorityFee = BigInt(Math.floor(Number(currentPriorityFee) * multiplier));
      
      // Apply buffer
      const bufferedPriorityFee = BigInt(Math.floor(Number(optimalPriorityFee) * this.gasConfig.priorityFeeBuffer));
      
      return bufferedPriorityFee;
    } catch (error) {
      this.logger.error('Error calculating optimal priority fee:', error);
      return currentPriorityFee;
    }
  }

  private async getNetworkCongestion(): Promise<number> {
    try {
      // Analyze recent gas price history to determine congestion
      if (this.gasPriceHistory.length < 10) {
        return 0.5; // Default to medium congestion
      }
      
      // Calculate gas price volatility
      const recentPrices = this.gasPriceHistory.slice(-10);
      const avgPrice = recentPrices.reduce((sum, data) => sum + Number(data.gasPrice), 0) / recentPrices.length;
      const variance = recentPrices.reduce((sum, data) => sum + Math.pow(Number(data.gasPrice) - avgPrice, 2), 0) / recentPrices.length;
      const volatility = Math.sqrt(variance) / avgPrice;
      
      // Higher volatility indicates higher congestion
      return Math.min(volatility * 2, 1.0);
      
    } catch (error) {
      this.logger.error('Error calculating network congestion:', error);
      return 0.5;
    }
  }

  private async updateGasPriceHistory(): Promise<void> {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt(0);
      const priorityFee = feeData.maxPriorityFeePerGas || BigInt(0);
      const maxFeePerGas = feeData.maxFeePerGas || BigInt(0);
      
      const networkCongestion = await this.getNetworkCongestion();
      
      const gasPriceData: GasPriceData = {
        gasPrice,
        priorityFee,
        maxFeePerGas,
        confidence: 0.8, // Placeholder confidence
        networkCongestion,
        recommendation: this.getGasPriceRecommendation(gasPrice, networkCongestion),
        timestamp: Date.now()
      };
      
      this.gasPriceHistory.push(gasPriceData);
      
      // Keep only recent history
      if (this.gasPriceHistory.length > this.gasConfig.gasPriceHistorySize) {
        this.gasPriceHistory = this.gasPriceHistory.slice(-this.gasConfig.gasPriceHistorySize);
      }
      
    } catch (error) {
      this.logger.error('Error updating gas price history:', error);
    }
  }

  private getGasPriceRecommendation(gasPrice: bigint, congestion: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));
    
    if (congestion > 0.8 || gasPriceGwei > 20) {
      return 'CRITICAL';
    } else if (congestion > 0.6 || gasPriceGwei > 10) {
      return 'HIGH';
    } else if (congestion > 0.3 || gasPriceGwei > 5) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  private determineOptimizationStrategy(congestion: number, walletCount: number): string {
    if (congestion > 0.8) {
      return 'HIGH_CONGESTION_BUNDLE';
    } else if (walletCount > 50) {
      return 'LARGE_BUNDLE_OPTIMIZATION';
    } else if (walletCount > 20) {
      return 'MEDIUM_BUNDLE_OPTIMIZATION';
    } else {
      return 'STANDARD_BUNDLE_OPTIMIZATION';
    }
  }

  public async estimateBundleGasCost(
    launchGasLimit: bigint,
    buyGasLimit: bigint,
    walletCount: number
  ): Promise<bigint> {
    try {
      const optimization = await this.optimizeBundleGas(launchGasLimit, buyGasLimit, walletCount);
      return optimization.totalGasCost + optimization.validatorTips;
    } catch (error) {
      this.logger.error('Error estimating bundle gas cost:', error);
      return BigInt(0);
    }
  }

  public async refreshGasPriceHistory(): Promise<void> {
    await this.updateGasPriceHistory();
  }

  public getGasPriceHistory(): GasPriceData[] {
    return [...this.gasPriceHistory];
  }

  public getGasPriceTrend(): 'INCREASING' | 'DECREASING' | 'STABLE' {
    try {
      if (this.gasPriceHistory.length < 5) {
        return 'STABLE';
      }
      
      const recentPrices = this.gasPriceHistory.slice(-5);
      const firstHalf = recentPrices.slice(0, 3);
      const secondHalf = recentPrices.slice(2);
      
      const firstAvg = firstHalf.reduce((sum, data) => sum + Number(data.gasPrice), 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, data) => sum + Number(data.gasPrice), 0) / secondHalf.length;
      
      const change = (secondAvg - firstAvg) / firstAvg;
      
      if (change > 0.05) return 'INCREASING';
      if (change < -0.05) return 'DECREASING';
      return 'STABLE';
      
    } catch (error) {
      this.logger.error('Error calculating gas price trend:', error);
      return 'STABLE';
    }
  }

  private loadGasConfig(): GasOptimizationConfig {
    return {
      enabled: this.config.get('GAS_OPTIMIZATION_ENABLED', true),
      dynamicPricing: this.config.get('DYNAMIC_GAS_PRICING', true),
      gasPriceBuffer: this.config.get('GAS_PRICE_BUFFER', 1.1),
      priorityFeeBuffer: this.config.get('PRIORITY_FEE_BUFFER', 1.2),
      maxGasPrice: this.config.get('MAX_GAS_PRICE', 20),
      minGasPrice: this.config.get('MIN_GAS_PRICE', 1),
      gasPriceHistorySize: this.config.get('GAS_PRICE_HISTORY_SIZE', 100),
      networkCongestionThreshold: this.config.get('NETWORK_CONGESTION_THRESHOLD', 0.6),
      validatorTipsEnabled: this.config.get('VALIDATOR_TIPS_ENABLED', true),
      validatorTipAmount: BigInt(this.config.get('VALIDATOR_TIP_AMOUNT', '0.001') * 1e18)
    };
  }

  public getGasConfig(): GasOptimizationConfig {
    return { ...this.gasConfig };
  }

  public updateGasConfig(newConfig: Partial<GasOptimizationConfig>): void {
    this.gasConfig = { ...this.gasConfig, ...newConfig };
    this.logger.info('Gas optimization configuration updated');
  }
}
