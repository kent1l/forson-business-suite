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

    const buildLocalGraph = async () => {
        const buildWanted = await askQuestion('\nWould you like to build the local AST index now? (y/N): ');
        rl.close();
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
    };

    const setupWanted = await askQuestion('Would you like to set up an LLM API key for Graphify initialization? (Y/n): ');
    
    if (setupWanted.trim().toLowerCase() === 'n') {
        console.log('Skipping LLM API key setup.');
        await buildLocalGraph();
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
    
    rl.close();

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
}

main().catch(err => {
    console.error(err);
    rl.close();
});
