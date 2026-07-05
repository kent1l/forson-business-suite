const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// 1. Skip in CI/CD or production
if (process.env.NODE_ENV === 'production' || process.env.CI || !process.stdin.isTTY) {
    console.log('Skipping interactive Graphify setup (Production, CI, or non-TTY environment).');
    process.exit(0);
}

const envPath = path.join(__dirname, '..', '.env');
let envContent = '';
if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

async function main() {
    console.log('\n=========================================');
    console.log('    Graphify Development Setup    ');
    console.log('=========================================\n');

    const installPlatformSkill = async () => {
        console.log('\nSelect your primary AI Coding Assistant/IDE:');
        console.log('1. Google Antigravity');
        console.log('2. Cursor');
        console.log('3. Claude Code');
        console.log('4. GitHub Copilot');
        console.log('5. Aider');
        console.log('6. Skip / Other (I will install it manually)');

        let platform = '';
        while (!platform) {
            const choice = await askQuestion('\nEnter the number of your assistant (1-6): ');
            switch (choice.trim()) {
                case '1': platform = 'antigravity'; break;
                case '2': platform = 'cursor'; break;
                case '3': platform = 'claude'; break;
                case '4': platform = 'copilot'; break;
                case '5': platform = 'aider'; break;
                case '6': platform = 'skip'; break;
                default: console.log('Invalid choice. Please enter a number from 1 to 6.');
            }
        }

        if (platform !== 'skip') {
            console.log(`\nInstalling Graphify skill for ${platform} in this project...`);
            try {
                execSync(`npx graphify ${platform} install --project`, { stdio: 'inherit' });
                console.log('✅ AI Assistant integration complete!');
            } catch (err) {
                console.error(`\nSkill installation failed. You can run it manually later with: npx graphify ${platform} install --project`);
            }
        }
    };

    const buildLocalGraph = async () => {
        const buildWanted = await askQuestion('\nWould you like to build the local AST index now? (y/N): ');
        if (buildWanted.trim().toLowerCase() === 'y') {
            console.log('\nStarting local Graphify build (AST extraction only, no LLM clustering)...');
            try {
                execSync('npx graphify extract . --no-cluster', { stdio: 'inherit' });
                console.log('✅ Local Graphify build complete!');
            } catch (err) {
                console.error('\nGraphify build failed. You can run it manually later with `npx graphify extract . --no-cluster`.');
            }
        } else {
            console.log('\nSetup complete. You can build the graph later by running: npx graphify extract . --no-cluster');
        }
        await installPlatformSkill();
    };

    const setupWanted = await askQuestion('Would you like to set up an LLM API key for Graphify initialization? (Y/n): ');
    
    if (setupWanted.trim().toLowerCase() === 'n') {
        console.log('Skipping LLM API key setup.');
        await buildLocalGraph();
        rl.close();
        return;
    }

    console.log('\nSelect your LLM Provider:');
    console.log('1. Google Gemini (Recommended)');
    console.log('2. Anthropic');
    console.log('3. OpenAI');
    
    let provider = '';
    while (!provider) {
        const choice = await askQuestion('\nEnter the number of your provider (1-3): ');
        switch (choice.trim()) {
            case '1': provider = 'google'; break;
            case '2': provider = 'anthropic'; break;
            case '3': provider = 'openai'; break;
            default: console.log('Invalid choice. Please enter 1, 2, or 3.');
        }
    }

    let model = '';
    let keyName = '';

    if (provider === 'google') {
        model = 'gemini-1.5-pro-latest';
        keyName = 'GEMINI_API_KEY';
    } else if (provider === 'anthropic') {
        model = 'claude-3-5-sonnet-20240620';
        keyName = 'ANTHROPIC_API_KEY';
    } else if (provider === 'openai') {
        model = 'gpt-4o';
        keyName = 'OPENAI_API_KEY';
    }

    const apiKey = await askQuestion(`\nPlease enter your ${keyName}: `);
    
    if (!apiKey.trim()) {
        console.log('\nNo API key provided. Skipping Graphify API setup.');
        await buildLocalGraph();
        rl.close();
        return;
    }

    // Append to or replace in .env
    let newEnvContent = envContent;
    if (!newEnvContent.endsWith('\n') && newEnvContent.length > 0) {
        newEnvContent += '\n';
    }

    const updateEnv = (key, value) => {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(newEnvContent)) {
            newEnvContent = newEnvContent.replace(regex, `${key}=${value}`);
        } else {
            newEnvContent += `${key}=${value}\n`;
        }
    };

    updateEnv(keyName, apiKey.trim());
    updateEnv('GRAPHIFY_MODEL', model);
    
    fs.writeFileSync(envPath, newEnvContent);
    console.log(`\n✅ Saved ${keyName} and set GRAPHIFY_MODEL=${model} to .env`);

    const buildWanted = await askQuestion('\nWould you like to build the Graphify index now? (y/N): ');

    if (buildWanted.trim().toLowerCase() === 'y') {
        console.log('\nStarting Graphify build...');
        try {
            execSync('npx graphify extract .', { stdio: 'inherit' });
            console.log('✅ Graphify build complete!');
        } catch (err) {
            console.error('\nGraphify build failed. You can run it manually later with `npx graphify extract .`.');
        }
    } else {
        console.log('\nSetup complete. You can build the graph later by running: npx graphify extract .');
    }

    await installPlatformSkill();
    rl.close();
}

main().catch(err => {
    console.error(err);
    rl.close();
});
