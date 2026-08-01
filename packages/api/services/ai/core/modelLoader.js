const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { z } = require('zod');

// Zod Schemas for Validation
const providerSchema = z.object({
    enabled: z.boolean().default(true),
    api_key_env: z.string().optional(),
    pool_env: z.string().optional(),
    base_url: z.string().optional()
});

const fallbackCandidateSchema = z.object({
    provider: z.string(),
    model: z.string()
});

const poolSchema = z.object({
    description: z.string().optional(),
    confidence_threshold: z.number().optional(),
    escalation_pool: z.string().optional(),
    fallback_chain: z.array(fallbackCandidateSchema).nonempty('fallback_chain must not be empty')
});

const aiModelsConfigSchema = z.object({
    version: z.string(),
    providers: z.record(z.string(), providerSchema),
    pools: z.record(z.string(), poolSchema)
});

class ModelLoader {
    constructor() {
        this.config = null;
        this.configPath = null;
    }

    _findConfigPath() {
        const candidatePaths = [
            path.resolve(__dirname, '../../../config/ai-models.yaml'),
            path.resolve(process.cwd(), 'config/ai-models.yaml'),
            path.resolve(process.cwd(), 'packages/api/config/ai-models.yaml')
        ];

        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        throw new Error(`AI model configuration file ai-models.yaml not found in candidate paths: ${candidatePaths.join(', ')}`);
    }

    loadConfig(filePath = null) {
        const resolvedPath = filePath || this._findConfigPath();
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const rawParsed = yaml.load(fileContent);

        const validated = aiModelsConfigSchema.parse(rawParsed);
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

    getPoolConfig(poolName) {
        const config = this.getConfig();
        const pool = config.pools[poolName];
        if (!pool) {
            throw new Error(`AI model pool '${poolName}' is not defined in ai-models.yaml`);
        }
        return pool;
    }

    getProviderConfig(providerName) {
        const config = this.getConfig();
        const provider = config.providers[providerName];
        if (!provider) {
            throw new Error(`AI provider '${providerName}' is not defined in ai-models.yaml`);
        }
        return provider;
    }

    getAllPools() {
        return this.getConfig().pools;
    }

    getAllProviders() {
        return this.getConfig().providers;
    }
}

const modelLoaderInstance = new ModelLoader();
module.exports = modelLoaderInstance;
