/**
 * HuggingFace FLUX.2 Inference Testing Script (Fetch Direct)
 *
 * Tests image-to-image inference with fal-ai provider using raw fetch
 *
 * Usage:
 *   npx ts-node scripts/test-hf-flux2-fetch.ts
 *
 * Requirements:
 *   - HF_TOKEN environment variable must be set
 *   - Test image must exist at ./test-assets/test-image.jpg
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const TEST_IMAGE_PATH = path.join(__dirname, "../test-assets/test-image.jpg");
const OUTPUT_PATH = path.join(
  __dirname,
  "../test-assets/output-flux2-fetch.png"
);

async function testFlux2WithFetch() {
  console.log("🧪 Testing FLUX.2-dev with fal-ai (raw fetch)\n");

  // Validate HF_TOKEN
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.error("❌ Error: HF_TOKEN environment variable not set");
    console.error("Please set it in .env.local file or export it:");
    console.error('  export HF_TOKEN="hf_..."');
    process.exit(1);
  }

  console.log("✅ HF_TOKEN found:", token.substring(0, 8) + "...");

  // Check if test image exists
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    console.error(`❌ Error: Test image not found at ${TEST_IMAGE_PATH}`);
    console.error(
      "\nPlease create test-assets directory and add a test image:"
    );
    console.error("  mkdir -p test-assets");
    console.error("  cp /path/to/your/image.jpg test-assets/test-image.jpg");
    process.exit(1);
  }

  console.log("✅ Test image found:", TEST_IMAGE_PATH);

  // Read and convert image to base64 data URI
  console.log("\n📸 Reading and converting to base64...");
  const imageBuffer = fs.readFileSync(TEST_IMAGE_PATH);
  const base64Image = imageBuffer.toString("base64");
  const dataUri = `data:image/jpeg;base64,${base64Image}`;
  console.log(`✅ Image converted: ${base64Image.length} chars\n`);

  // Request configuration - fal-ai format requires prompt and image_urls
  const requestBody = {
    prompt: "Turn the kid into a panda",
    image_urls: [dataUri],
  };

  console.log("📋 Request Configuration:");
  console.log("   URL: https://router.huggingface.co/fal-ai/flux-2-pro/edit");
  console.log("   Model: black-forest-labs/FLUX.2-dev");
  console.log("   Provider: fal-ai");
  console.log(`   Prompt: "${requestBody.prompt}"`);
  console.log(`   Image: data URI (${base64Image.length} chars)`);
  console.log("");

  try {
    console.log("🚀 Sending inference request...");
    const startTime = Date.now();

    // Using HuggingFace router with fal-ai provider
    const response = await fetch(
      "https://router.huggingface.co/fal-ai/flux-2/edit?_subdomain=queue",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "image/jpeg",
        },
        body: JSON.stringify(requestBody),
      }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(
      `\n📡 Response status: ${response.status} ${response.statusText}`
    );
    console.log(`   Duration: ${duration}s`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("\n❌ API request failed:");
      console.error(`   Status: ${response.status}`);
      console.error(`   Response: ${errorText}`);
      process.exit(1);
    }

    // Check content type to determine response format
    const contentType = response.headers.get("content-type") || "";
    console.log(`   Content-Type: ${contentType}`);

    if (contentType.includes("application/json")) {
      // JSON response (might be async job or error)
      const jsonResult = await response.json();
      console.log("\n📦 JSON Response:");
      console.log(JSON.stringify(jsonResult, null, 2));

      // If it contains an image URL, download it
      const imageUrl =
        jsonResult.images?.[0]?.url ||
        jsonResult.output?.image ||
        jsonResult.image ||
        jsonResult.url;

      if (imageUrl) {
        console.log(`\n📥 Downloading image from: ${imageUrl}`);
        const imageResponse = await fetch(imageUrl);
        const imageBlob = await imageResponse.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const outputDir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(OUTPUT_PATH, buffer);
        console.log(`✅ Result saved to: ${OUTPUT_PATH}`);
        console.log(`   Size: ${buffer.length} bytes`);
      }
    } else if (contentType.includes("image/")) {
      // Direct image response
      console.log("\n💾 Saving image result...");
      const resultBlob = await response.blob();
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
    } else {
      // Unknown response type
      const text = await response.text();
      console.log("\n📄 Raw Response:");
      console.log(text);
    }

    console.log("\n✨ Test completed!");
  } catch (error) {
    console.error("\n❌ Request failed:");
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    } else {
      console.error(`   Error: ${JSON.stringify(error, null, 2)}`);
    }
    process.exit(1);
  }
}

// Alternative: Test with HuggingFace Inference API format
async function testFlux2WithInferenceAPI() {
  console.log("\n🧪 Testing FLUX.2-dev with Inference API format\n");

  const token = process.env.HF_TOKEN;
  if (!token || !fs.existsSync(TEST_IMAGE_PATH)) {
    console.error("❌ Prerequisites not met");
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(TEST_IMAGE_PATH);
  const base64Image = imageBuffer.toString("base64");

  const requestBody = {
    inputs: `data:image/jpeg;base64,${base64Image}`,
    parameters: {
      prompt: "Turn this into a watercolor painting",
    },
  };

  console.log("📋 Using Inference API endpoint");
  console.log(
    "   URL: https://api-inference.huggingface.co/models/black-forest-labs/FLUX.2-dev"
  );
  console.log("");

  try {
    console.log("🚀 Sending request...");
    const startTime = Date.now();

    const response = await fetch(
      "https://api-inference.huggingface.co/models/fal-ai/flux-2-pro/edit",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-wait-for-model": "true",
        },
        body: JSON.stringify(requestBody),
      }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n📡 Response: ${response.status} (${duration}s)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed: ${errorText}`);
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    console.log(`   Content-Type: ${contentType}`);

    if (contentType.includes("image/")) {
      const blob = await response.blob();
      const buffer = Buffer.from(await blob.arrayBuffer());
      const outputPath = path.join(
        __dirname,
        "../test-assets/output-flux2-inference-api.png"
      );
      fs.writeFileSync(outputPath, buffer);
      console.log(`✅ Saved to: ${outputPath}`);
    } else {
      const result = await response.json();
      console.log("📦 Response:", JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Main execution
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  FLUX.2-dev Fetch Direct Test");
  console.log("═══════════════════════════════════════════════════\n");

  const testType = process.argv[2] || "router";

  if (testType === "router" || testType === "both") {
    console.log("Testing with router");
    await testFlux2WithFetch();
  }

  if (testType === "inference" || testType === "both") {
    console.log("Testing with inference API");
    await testFlux2WithInferenceAPI();
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Done! ✨");
  console.log("═══════════════════════════════════════════════════\n");
}

main();
