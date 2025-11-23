import { ipcMain, dialog, BrowserWindow } from "electron";
import { InferenceDispatcher } from "../services/inference/InferenceDispatcher";
import type { InferenceCall } from "../../types/inference";
import { getLogger } from "../services/logging";
import * as fs from "fs/promises";

const logger = getLogger();

// Cache dispatchers by API key to avoid recreating
const dispatcherCache = new Map<string, InferenceDispatcher>();

function getDispatcher(apiKey: string): InferenceDispatcher {
  if (!dispatcherCache.has(apiKey)) {
    dispatcherCache.set(apiKey, new InferenceDispatcher(apiKey));
  }
  return dispatcherCache.get(apiKey)!;
}

export function setupInferenceHandlers() {
  // Generic inference handler - dispatches based on task
  ipcMain.removeHandler("levante/inference/dispatch");
  ipcMain.handle(
    "levante/inference/dispatch",
    async (_, apiKey: string, call: InferenceCall) => {
      try {
        const dispatcher = getDispatcher(apiKey);
        const result = await dispatcher.dispatch(call);
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        logger.ipc.error("Inference dispatch failed", {
          task: call.task,
          model: call.model,
          error: error instanceof Error ? error.message : error,
        });
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown inference error",
        };
      }
    }
  );

  // Text-to-Image handler
  ipcMain.removeHandler("levante/inference/text-to-image");
  ipcMain.handle(
    "levante/inference/text-to-image",
    async (_, apiKey: string, model: string, prompt: string, options?: any) => {
      try {
        const dispatcher = getDispatcher(apiKey);
        const result = await dispatcher.dispatch({
          task: "text-to-image",
          model,
          input: { prompt },
          options,
        });
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        logger.ipc.error("Text-to-image failed", {
          model,
          error: error instanceof Error ? error.message : error,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Image-to-Text handler
  ipcMain.removeHandler("levante/inference/image-to-text");
  ipcMain.handle(
    "levante/inference/image-to-text",
    async (
      _,
      apiKey: string,
      model: string,
      imageBuffer: ArrayBuffer,
      options?: any
    ) => {
      try {
        const dispatcher = getDispatcher(apiKey);
        const result = await dispatcher.dispatch({
          task: "image-to-text",
          model,
          input: { image: Buffer.from(imageBuffer) },
          options,
        });
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        logger.ipc.error("Image-to-text failed", {
          model,
          error: error instanceof Error ? error.message : error,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Automatic Speech Recognition handler
  ipcMain.removeHandler("levante/inference/asr");
  ipcMain.handle(
    "levante/inference/asr",
    async (
      _,
      apiKey: string,
      model: string,
      audioBuffer: ArrayBuffer,
      options?: any
    ) => {
      try {
        const dispatcher = getDispatcher(apiKey);
        const result = await dispatcher.dispatch({
          task: "automatic-speech-recognition",
          model,
          input: { audio: Buffer.from(audioBuffer) },
          options,
        });
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        logger.ipc.error("ASR failed", {
          model,
          error: error instanceof Error ? error.message : error,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // Save image to disk with native dialog
  ipcMain.removeHandler("levante/inference/save-image");
  ipcMain.handle(
    "levante/inference/save-image",
    async (event, dataUrl: string, defaultFilename: string) => {
      try {
        // Get the window that sent the request
        const win = BrowserWindow.fromWebContents(event.sender);

        const options = {
          defaultPath: defaultFilename,
          filters: [
            { name: "PNG Image", extensions: ["png"] },
            { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
            { name: "WebP Image", extensions: ["webp"] },
            { name: "All Images", extensions: ["png", "jpg", "jpeg", "webp"] },
          ],
        };

        const { filePath, canceled } = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);

        if (canceled || !filePath) {
          return { success: false, error: "Save cancelled by user" };
        }

        // Extract base64 data from dataUrl
        const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
          throw new Error("Invalid image data URL format");
        }

        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");

        // Write file to disk
        await fs.writeFile(filePath, buffer);

        logger.ipc.info("Image saved to disk", {
          filePath,
          size: buffer.length,
        });

        return {
          success: true,
          data: filePath,
        };
      } catch (error) {
        logger.ipc.error("Failed to save image", {
          error: error instanceof Error ? error.message : error,
        });
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown error saving image",
        };
      }
    }
  );
  logger.ipc.info("Inference IPC handlers registered");
}
