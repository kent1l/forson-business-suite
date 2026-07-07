require('dotenv').config();
const llmRouter = require('../services/llmRouter');

async function testAI() {
    console.log(`\n🤖 Testing LLM Router...`);
    console.log(`Provider: ${llmRouter.provider.toUpperCase()}`);
    
    // Test Case: These should be recognized as the exact same item
    const partA = {
        display_name: 'Hex Bolt M8x20mm',
        detail: 'Stainless steel A2, fully threaded',
        brand_name: 'FastenPro',
        part_numbers: ['FP-HB-M820']
    };

    const partB = {
        display_name: 'M8 x 20mm Hexagon Head Bolt',
        detail: 'A2 Stainless Steel Threaded Bolt',
        brand_name: 'FastenPro',
        part_numbers: []
    };

    console.log('\n--- Sending parts to AI for Evaluation ---');
    console.log('Part A:', partA.display_name);
    console.log('Part B:', partB.display_name);
    console.log('Waiting for AI response...\n');
    
    try {
        const isDuplicate = await llmRouter.verifyDuplicate(partA, partB);
        if (isDuplicate) {
            console.log('✅ AI Conclusion: THESE ARE DUPLICATES');
        } else {
            console.log('❌ AI Conclusion: THESE ARE DIFFERENT ITEMS');
        }
    } catch (err) {
        console.error('🚨 AI Request Failed:', err.message);
        console.log('\nHint: Check your API Key and Model name in the .env file!');
    }
}

testAI();
