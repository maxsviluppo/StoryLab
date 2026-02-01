import { Injectable } from '@angular/core';
import { GoogleGenAI } from "@google/genai";

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env['API_KEY'] || '' });
  }

  /**
   * Helper to handle API Rate Limits (429) with exponential backoff.
   * Retries the operation if it fails with specific error codes.
   */
  private async retryOperation<T>(operation: () => Promise<T>, retries = 5, delay = 3000): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      let code = error?.status || error?.code;
      let message = error?.message || '';
      let status = error?.statusText || '';

      // Handle nested error object structure often returned by Google APIs
      // e.g. { error: { code: 429, message: "...", status: "RESOURCE_EXHAUSTED" } }
      if (error?.error) {
        code = error.error.code || code;
        message = error.error.message || message;
        status = error.error.status || status;
      }
      
      const isRateLimit = code === 429 || 
                          message.includes('429') || 
                          message.includes('Quota') || 
                          status.includes('RESOURCE_EXHAUSTED') ||
                          message.includes('RESOURCE_EXHAUSTED');
                          
      const isServerUnavailable = code === 503;
      
      if (retries > 0 && (isRateLimit || isServerUnavailable)) {
        console.warn(`Gemini API Busy (429/503). Retrying in ${delay}ms... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryOperation(operation, retries - 1, delay * 2);
      }
      throw error;
    }
  }

  /**
   * Uses Gemini 2.5 Flash to analyze an input image or text and generate a detailed
   * visual description suitable for image generation prompts.
   */
  async refineCharacterPrompt(imageBase64: string | null, userHint: string): Promise<string> {
    return this.retryOperation(async () => {
      try {
        const parts: any[] = [];
        
        // System instruction embedded in prompt for Flash
        let promptText = `Analizza il soggetto fornito. Crea una descrizione visiva dettagliata e concisa (in inglese, ottimizzata per text-to-image prompts). 
        Focalizzati su: aspetto fisico, abbigliamento, caratteristiche distintive del viso e stile artistico. 
        Non inventare elementi non presenti, sii fedele all'input. Output solo il prompt descrittivo.`;

        if (userHint) {
          promptText += `\nNote aggiuntive utente: ${userHint}`;
        }

        if (imageBase64) {
          // Clean base64 header if present
          const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg', // Assuming jpeg/png generic handling
              data: cleanBase64
            }
          });
        }

        parts.push({ text: promptText });

        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: parts },
          config: {
              temperature: 0.4, // Lower temperature for more factual analysis
              maxOutputTokens: 300
          }
        });

        return response.text.trim();
      } catch (error) {
        console.error('Error analyzing character:', error);
        throw error;
      }
    });
  }

  /**
   * Generates a "Subject" (Model) image using Imagen 3.
   */
  async generateSubjectModel(prompt: string): Promise<string> {
    return this.retryOperation(async () => {
      try {
        const response = await this.ai.models.generateImages({
          model: 'imagen-4.0-generate-001',
          prompt: prompt,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '1:1',
          },
        });

        if (response.generatedImages && response.generatedImages.length > 0) {
          return `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`;
        }
        throw new Error('No image generated');
      } catch (error) {
        console.error('Error generating subject:', error);
        throw error;
      }
    });
  }

  /**
   * Generates a new Image Project combining multiple subject descriptions and a scene context.
   */
  async generateSceneImage(combinedPrompt: string, aspectRatio: string): Promise<string> {
    return this.retryOperation(async () => {
      try {
        const response = await this.ai.models.generateImages({
          model: 'imagen-4.0-generate-001',
          prompt: combinedPrompt,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: aspectRatio, // Passed from UI
          },
        });

        if (response.generatedImages && response.generatedImages.length > 0) {
          return `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`;
        }
        throw new Error('No scene image generated');
      } catch (error) {
        console.error('Error generating scene:', error);
        throw error;
      }
    });
  }

  /**
   * Generates a Video using Veo 2.0.
   * Uses the primary subject's image as a reference anchor.
   */
  async generateSceneVideo(primarySubjectImageBase64: string, scenePrompt: string): Promise<string> {
    try {
      // Remove data:image/jpeg;base64, prefix if present for the raw bytes
      const cleanBase64 = primarySubjectImageBase64.split(',')[1] || primarySubjectImageBase64;

      // 1. Initial Request with Retry
      let operation = await this.retryOperation(async () => {
        return await this.ai.models.generateVideos({
          model: 'veo-2.0-generate-001',
          prompt: scenePrompt,
          image: {
            imageBytes: cleanBase64,
            mimeType: 'image/jpeg'
          },
          config: {
            numberOfVideos: 1
          }
        });
      });

      // Polling loop
      while (!operation.done) {
        // Wait 30 seconds (Increased from 10s to avoid 429 quota errors on free tier)
        // Veo generation takes time, checking too often burns quota.
        await new Promise(resolve => setTimeout(resolve, 30000));
        console.log('Polling video generation status (30s interval)...');
        
        // 2. Polling Request with Retry (just in case)
        operation = await this.retryOperation(async () => {
           return await this.ai.operations.getVideosOperation({ operation: operation });
        });
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!videoUri) throw new Error("Video generation failed to return a URI.");

      // Fetch the actual video blob
      // We can retry this fetch too if needed, but usually 429 happens on the AI endpoint not the storage
      const videoRes = await fetch(`${videoUri}&key=${process.env['API_KEY']}`);
      
      if (!videoRes.ok) {
         throw new Error(`Failed to download video: ${videoRes.statusText}`);
      }
      
      const videoBlob = await videoRes.blob();
      return URL.createObjectURL(videoBlob);

    } catch (error) {
      console.error('Error generating video:', error);
      throw error;
    }
  }
}