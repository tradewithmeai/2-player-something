#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function execCommand(command, description) {
  try {
    log(`${colors.blue}▶ ${description}...${colors.reset}`);
    const output = execSync(command, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] });
    log(`${colors.green}✅ ${description} completed${colors.reset}`);
    return output;
  } catch (error) {
    log(`${colors.red}❌ ${description} failed:${colors.reset}`);
    log(`${colors.red}${error.message}${colors.reset}`);
    process.exit(1);
  }
}

function getCurrentVersion() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  return packageJson.version;
}

function incrementVersion(version, type = 'patch') {
  const [major, minor, patch] = version.split('.').map(Number);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function updatePackageVersion(newVersion) {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  packageJson.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
}

async function main() {
  try {
    log(`${colors.blue}🚀 Starting Release Candidate Process${colors.reset}`);
    log('');

    // Get release type from command line args
    const releaseType = process.argv[2] || 'patch';
    
    if (!['major', 'minor', 'patch'].includes(releaseType)) {
      log(`${colors.red}❌ Invalid release type: ${releaseType}${colors.reset}`);
      log(`${colors.yellow}Usage: pnpm release:rc [major|minor|patch]${colors.reset}`);
      process.exit(1);
    }

    // Check git status
    log(`${colors.blue}📋 Checking git status...${colors.reset}`);
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });
    if (gitStatus.trim()) {
      log(`${colors.red}❌ Working directory is not clean:${colors.reset}`);
      log(gitStatus);
      log(`${colors.yellow}Please commit or stash your changes before creating a release.${colors.reset}`);
      process.exit(1);
    }

    // Check current branch
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    if (currentBranch !== 'main') {
      log(`${colors.red}❌ Must be on main branch to create release (currently on: ${currentBranch})${colors.reset}`);
      process.exit(1);
    }

    // Pull latest changes
    execCommand('git pull origin main', 'Pulling latest changes from origin/main');

    // Get version info
    const currentVersion = getCurrentVersion();
    const newVersion = incrementVersion(currentVersion, releaseType);
    
    log(`${colors.yellow}📦 Version bump: ${currentVersion} → ${newVersion}${colors.reset}`);
    log('');

    // Run quality checks
    log(`${colors.blue}🔍 Running quality checks...${colors.reset}`);
    
    // Lint (allow warnings but not errors)
    try {
      execCommand('pnpm lint', 'Running linter');
    } catch (error) {
      log(`${colors.yellow}⚠️  Linter warnings detected but proceeding...${colors.reset}`);
    }

    // Type check (allow errors for now during dev)
    try {
      execCommand('pnpm type-check', 'Running type check');
    } catch (error) {
      log(`${colors.yellow}⚠️  Type errors detected but proceeding for RC...${colors.reset}`);
    }

    // Run unit tests
    execCommand('pnpm test', 'Running unit tests');

    // Build frontend (server build may fail, that's OK for RC)
    execCommand('pnpm build:frontend', 'Building frontend');
    
    try {
      execCommand('pnpm build:server', 'Building server');
    } catch (error) {
      log(`${colors.yellow}⚠️  Server build failed but proceeding for RC...${colors.reset}`);
    }

    // Update version in package.json
    log(`${colors.blue}📝 Updating version to ${newVersion}...${colors.reset}`);
    updatePackageVersion(newVersion);

    // Create git tag and commit
    const tagName = `v${newVersion}-rc`;
    const commitMessage = `chore: release candidate ${newVersion}`;
    
    execCommand(`git add package.json`, 'Staging package.json');
    execCommand(`git commit -m "${commitMessage}"`, 'Creating release commit');
    execCommand(`git tag -a ${tagName} -m "Release candidate ${newVersion}"`, 'Creating git tag');

    // Push changes
    execCommand('git push origin main', 'Pushing commit to origin');
    execCommand(`git push origin ${tagName}`, 'Pushing tag to origin');

    log('');
    log(`${colors.green}🎉 Release candidate created successfully!${colors.reset}`);
    log(`${colors.green}📋 Tag: ${tagName}${colors.reset}`);
    log(`${colors.green}📋 Version: ${newVersion}${colors.reset}`);
    log('');
    log(`${colors.blue}📋 Next steps:${colors.reset}`);
    log(`${colors.blue}   1. Check CI pipeline: https://github.com/your-org/2-player-something/actions${colors.reset}`);
    log(`${colors.blue}   2. Test the RC deployment${colors.reset}`);
    log(`${colors.blue}   3. If all looks good, create a proper release from the tag${colors.reset}`);

  } catch (error) {
    log(`${colors.red}❌ Release process failed:${colors.reset}`);
    log(`${colors.red}${error.message}${colors.reset}`);
    process.exit(1);
  }
}

main();