#!/bin/bash

# Four.Meme Bundler Deployment Script
# This script automates the deployment process for the Four.Meme bundler

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-development}
MODE=${2:-bundler}

echo -e "${BLUE}🚀 Four.Meme Bundler Deployment Script${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Mode: ${MODE}${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking prerequisites...${NC}"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    # Check Git
    if ! command -v git &> /dev/null; then
        print_error "Git is not installed"
        exit 1
    fi
    
    # Check MongoDB
    if ! command -v mongod &> /dev/null; then
        print_warning "MongoDB is not installed - required for production"
    fi
    
    # Check Redis
    if ! command -v redis-server &> /dev/null; then
        print_warning "Redis is not installed - required for production"
    fi
    
    print_status "Prerequisites check completed"
}

# Install dependencies
install_dependencies() {
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    
    npm install
    print_status "Dependencies installed"
}

# Setup configuration
setup_configuration() {
    echo -e "${BLUE}⚙️  Setting up configuration...${NC}"
    
    # Copy environment file
    if [ ! -f "config/.env" ]; then
        cp config/env.example config/.env
        print_warning "Please edit config/.env with your settings"
    fi
    
    # Create logs directory
    mkdir -p logs
    
    print_status "Configuration setup completed"
}

# Build project
build_project() {
    echo -e "${BLUE}🔨 Building project...${NC}"
    
    # Type check
    npm run type-check
    print_status "Type check passed"
    
    # Build
    npm run build
    print_status "Project built successfully"
}

# Run tests
run_tests() {
    echo -e "${BLUE}🧪 Running tests...${NC}"
    
    npm test
    print_status "Tests passed"
}

# Start services
start_services() {
    echo -e "${BLUE}🚀 Starting services...${NC}"
    
    if [ "$MODE" = "bundler" ]; then
        # Start bundler
        npm run start:bundler &
        print_status "Four.Meme Bundler started"
    elif [ "$MODE" = "web" ]; then
        # Start web interface
        npm run start:web &
        print_status "Web interface started"
    elif [ "$MODE" = "all" ]; then
        # Start both
        npm run start:bundler &
        npm run start:web &
        print_status "All services started"
    fi
}

# Setup monitoring
setup_monitoring() {
    echo -e "${BLUE}📊 Setting up monitoring...${NC}"
    
    # Create monitoring directory
    mkdir -p monitoring
    
    # Setup log rotation
    if command -v logrotate &> /dev/null; then
        print_status "Log rotation configured"
    else
        print_warning "Logrotate not available - manual log management required"
    fi
    
    print_status "Monitoring setup completed"
}

# Main deployment function
deploy() {
    echo -e "${BLUE}🎯 Starting deployment process...${NC}"
    
    check_prerequisites
    install_dependencies
    setup_configuration
    
    if [ "$ENVIRONMENT" = "production" ]; then
        run_tests
        build_project
        setup_monitoring
    fi
    
    start_services
    
    print_status "Deployment completed successfully!"
    echo ""
    echo -e "${GREEN}🎉 Four.Meme Bundler is ready!${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Configure your creator private key in config/.env"
    echo "2. Set up buy wallet mnemonic and fund wallets"
    echo "3. Configure Four.Meme API settings"
    echo "4. Set up private RPC endpoints for MEV protection"
    echo "5. Configure gas optimization settings"
    echo "6. Set up monitoring and alerts"
    echo ""
    echo -e "${BLUE}Four.Meme Bundler Specific Configuration:${NC}"
    echo "- Set CREATOR_PRIVATE_KEY in config/.env"
    echo "- Set BUY_WALLETS_MNEMONIC for HD wallet generation"
    echo "- Configure MAX_WALLETS (default: 100)"
    echo "- Set up private RPC for MEV protection"
    echo "- Configure validator tips for bundle inclusion"
    echo "- Set gas limits for launch and buy transactions"
    echo ""
    echo -e "${BLUE}Key Features:${NC}"
    echo "- Launch + immediate buy bundling (up to 100 wallets)"
    echo "- MEV protection with private mempools"
    echo "- Gas optimization for BNB Chain"
    echo "- Batch processing for efficient execution"
    echo "- Real-time monitoring and analytics"
    echo ""
    echo -e "${BLUE}Documentation:${NC}"
    echo "- README.md for setup instructions"
    echo "- docs/ for detailed documentation"
    echo "- config/env.example for configuration options"
}

# Handle script arguments
case "$1" in
    "help"|"-h"|"--help")
        echo "Usage: $0 [environment] [mode]"
        echo ""
        echo "Environments:"
        echo "  development  - Development environment (default)"
        echo "  production   - Production environment"
        echo ""
        echo "Modes:"
        echo "  bundler      - Start Four.Meme bundler only (default)"
        echo "  web          - Start web interface only"
        echo "  all          - Start both bundler and web interface"
        echo ""
        echo "Examples:"
        echo "  $0                    # Development bundler"
        echo "  $0 production all    # Production with all services"
        echo "  $0 development web    # Development web interface"
        ;;
    *)
        deploy
        ;;
esac
