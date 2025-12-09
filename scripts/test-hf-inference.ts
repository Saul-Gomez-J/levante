/**
 * HuggingFace Inference Testing Script
 *
 * Tests image-to-image inference with WaveSpeed provider
 *
 * Usage:
 *   ts-node scripts/test-hf-inference.ts
 *
 * Requirements:
 *   - HF_TOKEN environment variable must be set
 *   - Test image must exist at ./test-assets/test-image.jpg (or modify path)
 */

import { InferenceClient } from "@huggingface/inference";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const TEST_IMAGE_PATH = path.join(__dirname, '../test-assets/test-image.jpg');
const OUTPUT_PATH = path.join(__dirname, '../test-assets/output-image.png');

async function testImageToImage() {
  console.log('🧪 Testing HuggingFace Image-to-Image Inference\n');

  // Validate HF_TOKEN
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.error('❌ Error: HF_TOKEN environment variable not set');
    console.error('Please set it in .env.local file or export it:');
    console.error('  export HF_TOKEN="hf_..."');
    process.exit(1);
  }

  console.log('✅ HF_TOKEN found:', token.substring(0, 8) + '...');

  // Check if test image exists
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    console.error(`❌ Error: Test image not found at ${TEST_IMAGE_PATH}`);
    console.error('\nPlease create test-assets directory and add a test image:');
    console.error('  mkdir -p test-assets');
    console.error('  cp /path/to/your/image.jpg test-assets/test-image.jpg');
    process.exit(1);
  }

  console.log('✅ Test image found:', TEST_IMAGE_PATH);

  // Initialize client
  const client = new InferenceClient(token);
  console.log('✅ InferenceClient initialized\n');

  // Read test image
  console.log('📸 Reading test image...');
  const imageBuffer = fs.readFileSync(TEST_IMAGE_PATH);
  console.log(`✅ Image loaded: ${imageBuffer.length} bytes`);

  // Convert Buffer to Blob (required by SDK)
  const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });
  console.log(`✅ Converted to Blob: ${imageBlob.size} bytes\n`);

  // Test configuration
  const config = {
    provider: "wavespeed" as any,
    model: "Qwen/Qwen-Image-Edit-2509",
    inputs: imageBlob,
    parameters: {
      prompt: "Turn this into a beautiful watercolor painting",
    },
  };

  console.log('📋 Test Configuration:');
  console.log(`   Provider: ${config.provider}`);
  console.log(`   Model: ${config.model}`);
  console.log(`   Prompt: "${config.parameters.prompt}"`);
  console.log('');

  try {
    console.log('🚀 Sending inference request...');
    const startTime = Date.now();

    const resultBlob = await client.imageToImage(config);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Inference completed in ${duration}s\n`);

    // Convert Blob to Buffer and save
    console.log('💾 Saving result...');
    const arrayBuffer = await resultBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, buffer);

    console.log(`✅ Result saved to: ${OUTPUT_PATH}`);
    console.log(`   Size: ${buffer.length} bytes`);
    console.log(`   Type: ${resultBlob.type || 'image/png'}`);
    console.log('\n✨ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Inference failed:');
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    } else {
      console.error(`   Error: ${JSON.stringify(error, null, 2)}`);
    }
    process.exit(1);
  }
}

// Alternative test with direct API call (uses 'images' parameter)
async function testImageToImageDirectAPI() {
  console.log('\n🧪 Testing Direct API Call (images parameter)\n');

  const token = process.env.HF_TOKEN;
  if (!token) {
    console.error('❌ Error: HF_TOKEN not set');
    process.exit(1);
  }

  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    console.error(`❌ Error: Test image not found at ${TEST_IMAGE_PATH}`);
    process.exit(1);
  }

  console.log('📸 Reading and converting to base64...');
  const imageData = fs.readFileSync(TEST_IMAGE_PATH);
  const base64 = imageData.toString('base64');
  console.log(`✅ Image converted: ${base64.length} chars\n`);

  const requestBody = {
    images: [base64], // WaveSpeed format
    parameters: {
      prompt: "Turn this into a beautiful watercolor painting",
    },
  };

  console.log('📋 Request Configuration:');
  console.log(`   Model: Qwen/Qwen-Image-Edit-2509`);
  console.log(`   Provider: wavespeed`);
  console.log(`   Images array: [base64_string]`);
  console.log('');

  try {
    console.log('🚀 Sending direct API request...');
    const startTime = Date.now();

    const response = await fetch('https://api.huggingface.co/models/Qwen/Qwen-Image-Edit-2509', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-provider': 'wavespeed',
      },
      body: JSON.stringify(requestBody),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    console.log(`✅ API request completed in ${duration}s\n`);

    const resultBlob = await response.blob();

    // Save result
    console.log('💾 Saving result...');
    const arrayBuffer = await resultBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const outputPath = path.join(__dirname, '../test-assets/output-image-direct.png');
    fs.writeFileSync(outputPath, buffer);

    console.log(`✅ Result saved to: ${outputPath}`);
    console.log(`   Size: ${buffer.length} bytes`);
    console.log(`   Type: ${resultBlob.type || 'image/png'}`);
    console.log('\n✨ Direct API test completed successfully!');

  } catch (error) {
    console.error('\n❌ Direct API call failed:');
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    } else {
      console.error(`   Error: ${JSON.stringify(error, null, 2)}`);
    }
    process.exit(1);
  }
}

// Main execution
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  HuggingFace Image-to-Image Inference Tests');
  console.log('═══════════════════════════════════════════════════\n');

  const testType = process.argv[2] || 'both';

  try {
    if (testType === 'sdk' || testType === 'both') {
      await testImageToImage();
    }

    if (testType === 'direct' || testType === 'both') {
      await testImageToImageDirectAPI();
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  All tests completed! ✨');
    console.log('═══════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Run tests
main();
