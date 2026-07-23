const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { z } = require('zod');

// Zod Schemas for Validation
const fallbackCandidateSchema = z.object({
    provider: z.string(),
    model: z.string(),
    api_key_env: z.string().optional(),
    dimensions_override: z.number().optional()
});

const embeddingPoolSchema = z.object({
    description: z.string().optional(),
    dimensions: z.number().default(768),
    fallback_chain: z.array(fallbackCandidateSchema).nonempty('fallback_chain must not be empty')
});

const aiEmbeddingsConfigSchema = z.object({
    version: z.string(),
    pools: z.record(z.string(), embeddingPoolSchema)
});

class EmbeddingLoader {
    constructor() {
        this.config = null;
        this.configPath = null;
    }

    _findConfigPath() {
        const candidatePaths = [
            path.resolve(__dirname, '../../../config/ai-embeddings.yaml'),
            path.resolve(process.cwd(), 'config/ai-embeddings.yaml'),
            path.resolve(process.cwd(), 'packages/api/config/ai-embeddings.yaml')
        ];

        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        throw new Error(`AI embeddings configuration file ai-embeddings.yaml not found in candidate paths: ${candidatePaths.join(', ')}`);
    }

    loadConfig(filePath = null) {
        const resolvedPath = filePath || this._findConfigPath();
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const rawParsed = yaml.load(fileContent);

        const validated = aiEmbeddingsConfigSchema.parse(rawParsed);
        this.config = validated;
        this.configPath = resolvedPath;
        return this.config;
    }

    getConfig() {
        if (!this.config) {
            this.loadConfig();
        }
        return this.config;
    }

    getPoolConfig(poolName = 'default_embedding_pool') {
        const config = this.getConfig();
        const pool = config.pools[poolName];
        if (!pool) {
            throw new Error(`AI embedding pool '${poolName}' is not defined in ai-embeddings.yaml`);
        }
        return pool;
    }
}

const embeddingLoaderInstance = new EmbeddingLoader();
module.exports = embeddingLoaderInstance;
