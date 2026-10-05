#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up Mandi Commission Agent App...\n');

// Check if Node.js version is compatible
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (majorVersion < 18) {
  console.error('❌ Node.js version 18 or higher is required');
  console.error(`Current version: ${nodeVersion}`);
  process.exit(1);
}

console.log('✅ Node.js version check passed');

// Check if dependencies are installed
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  console.log('✅ Package.json found');
} catch (error) {
  console.error('❌ Package.json not found. Make sure you are in the project root directory.');
  process.exit(1);
}

// Install dependencies if node_modules doesn't exist
if (!fs.existsSync('node_modules')) {
  console.log('\n📦 Installing dependencies...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('✅ Dependencies installed successfully');
  } catch (error) {
    console.error('❌ Failed to install dependencies');
    process.exit(1);
  }
} else {
  console.log('✅ Dependencies already installed');
}

// Check if Supabase CLI is installed
try {
  execSync('supabase --version', { stdio: 'ignore' });
  console.log('✅ Supabase CLI found');
} catch (error) {
  console.log('\n📦 Installing Supabase CLI...');
  try {
    execSync('npm install -g supabase', { stdio: 'inherit' });
    console.log('✅ Supabase CLI installed');
  } catch (error) {
    console.error('❌ Failed to install Supabase CLI');
    console.log('Please install it manually: npm install -g supabase');
  }
}

// Create database directory if it doesn't exist
const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('✅ Database directory created');
}

// Check if schema.sql exists
const schemaPath = path.join(dbDir, 'schema.sql');
if (!fs.existsSync(schemaPath)) {
  console.error('❌ Database schema not found at database/schema.sql');
  console.log('Please ensure the schema file exists before proceeding.');
} else {
  console.log('✅ Database schema found');
}

console.log('\n🎉 Setup completed successfully!');
console.log('\n📋 Next steps:');
console.log('1. Start local Supabase: supabase start');
console.log('2. Apply database schema: supabase db reset --linked');
console.log('3. Start the app: npm start');
console.log('\n📚 For detailed instructions, see README.md');
console.log('🌐 Supabase Studio will be available at: http://localhost:54323');
console.log('🔗 API endpoint: http://localhost:54321');

console.log('\n💡 Tips:');
console.log('- Make sure Docker is running before starting Supabase');
console.log('- The app is configured to connect to local Supabase by default');
console.log('- Check lib/supabase.ts for connection settings');
console.log('- Use npm run ios/android/web to run on specific platforms'); 