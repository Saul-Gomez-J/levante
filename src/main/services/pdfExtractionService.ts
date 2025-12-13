import { getLogger } from './logging';
import { createHash } from 'crypto';
import { Buffer } from 'node:buffer';

// Lazy-loaded pdf-parse module
// We load it only when needed to avoid startup failures
let pdfParser: any = null;
let pdfParserLoadAttempted = false;

/**
 * Lazy load the pdf-parse module
 * Only loads once, on first use
 */
function loadPdfParser(): any {
    // Return cached parser if already loaded
    if (pdfParser !== null) {
        return pdfParser;
    }

    // Don't retry if we already failed
    if (pdfParserLoadAttempted) {
        throw new Error('pdf-parse module previously failed to load');
    }

    pdfParserLoadAttempted = true;

    try {
        const pdfModule = require('pdf-parse');

        // pdf-parse v2.x exports PDFParse as a named export
        pdfParser = pdfModule.PDFParse || pdfModule.default || pdfModule;

        if (typeof pdfParser !== 'function') {
            throw new Error('pdf-parse module structure not recognized');
        }

        return pdfParser;
    } catch (error) {
        const logger = getLogger();
        logger.aiSdk.error('Failed to load pdf-parse module', {
            error: error instanceof Error ? error.message : error,
        });
        throw new Error(`pdf-parse module could not be loaded: ${error instanceof Error ? error.message : error}`);
    }
}

export interface PDFExtractionResult {
    success: boolean;
    text?: string;
    pages?: number;
    info?: any;
    error?: string;
    isPasswordProtected?: boolean;
}

export interface PDFExtractionOptions {
    maxPages?: number;
    maxLength?: number;
}

interface CacheEntry {
    text: string;
    pages: number;
    info: any;
    timestamp: number;
}

/**
 * Service to handle PDF text extraction
 */
export class PDFExtractionService {
    private cache: Map<string, CacheEntry>;
    private readonly MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB approx limit for cache text content
    private currentCacheSize = 0;
    private logger = getLogger();

    constructor() {
        this.cache = new Map();
    }

    /**
     * Extract text from a PDF buffer
     */
    async extractText(
        buffer: Buffer,
        options: PDFExtractionOptions = {}
    ): Promise<PDFExtractionResult> {
        const { maxPages = 50, maxLength = 50000 } = options;

        try {
            // Generate hash for caching
            const hash = createHash('md5').update(buffer).digest('hex');

            // Check cache
            if (this.cache.has(hash)) {
                const cached = this.cache.get(hash)!;
                cached.timestamp = Date.now();
                return {
                    success: true,
                    text: cached.text,
                    pages: cached.pages,
                    info: cached.info
                };
            }

            // Load the pdf parser (lazy loading)
            const parser = loadPdfParser();

            // Convert Buffer to Uint8Array (pdf-parse v2 requires Uint8Array, not Buffer)
            const uint8Array = new Uint8Array(buffer);

            // Instantiate PDFParse
            const parserInstance = new parser(uint8Array, { max: maxPages });

            // Extract text with page separators
            const textResult = await parserInstance.getText();

            // Extract metadata
            let pdfInfo: any = {};
            try {
                if (typeof parserInstance.getInfo === 'function') {
                    pdfInfo = await parserInstance.getInfo();
                }
            } catch (e) {
                // Metadata extraction failed, continue without it
            }

            // Format text with page separators
            let text = '';
            let pages = 0;

            if (textResult && textResult.pages && Array.isArray(textResult.pages)) {
                text = textResult.pages
                    .map((page: any, index: number) => {
                        return `--- Page ${index + 1} ---\n${page.text || ''}`;
                    })
                    .join('\n\n');
                pages = textResult.pages.length;
            } else if (typeof textResult === 'string') {
                // Fallback if getText() returns a plain string
                text = textResult;
                pages = 1;
            } else {
                throw new Error('Unexpected getText() result format');
            }

            // Validate that we got text
            if (!text || typeof text !== 'string') {
                return {
                    success: false,
                    error: 'PDF parsing did not return text content',
                };
            }

            // Truncate if needed
            if (text.length > maxLength) {
                text = text.substring(0, maxLength) + '\n...[Content truncated]...';
            }

            // Cache result
            this.addToCache(hash, {
                text,
                pages,
                info: pdfInfo,
                timestamp: Date.now()
            });

            return {
                success: true,
                text,
                pages,
                info: pdfInfo
            };

        } catch (error) {
            // Check for password-protected PDFs
            if (error instanceof Error) {
                if (error.name === 'PasswordException' || error.message?.includes('password')) {
                    return { success: false, isPasswordProtected: true, error: 'Password protected PDF' };
                }
                this.logger.aiSdk.error('PDF extraction failed', { error: error.message });
            }

            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown extraction error'
            };
        }
    }

    private addToCache(key: string, entry: CacheEntry) {
        // Simple cache eviction
        const entrySize = entry.text.length * 2; // Approx bytes

        if (entrySize > this.MAX_CACHE_SIZE) {
            // Too big to cache
            return;
        }

        while (this.currentCacheSize + entrySize > this.MAX_CACHE_SIZE && this.cache.size > 0) {
            // Remove oldest
            let oldestKey: string | null = null;
            let oldestTime = Infinity;

            for (const [k, v] of this.cache.entries()) {
                if (v.timestamp < oldestTime) {
                    oldestTime = v.timestamp;
                    oldestKey = k;
                }
            }

            if (oldestKey) {
                const removed = this.cache.get(oldestKey)!;
                this.cache.delete(oldestKey);
                this.currentCacheSize -= removed.text.length * 2;
            } else {
                break; // Should not happen
            }
        }

        this.cache.set(key, entry);
        this.currentCacheSize += entrySize;
    }

    clearCache() {
        this.cache.clear();
        this.currentCacheSize = 0;
    }
}

export const pdfExtractionService = new PDFExtractionService();
