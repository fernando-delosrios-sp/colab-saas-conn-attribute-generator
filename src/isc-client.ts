import {
    Account,
    AccountsApi,
    AccountsApiListAccountsRequest,
    Configuration,
    ConfigurationParameters,
    IdentityDocument,
    Index,
    JsonPatchOperation,
    Paginator,
    PublicIdentitiesConfigApi,
    PublicIdentityConfig,
    Search,
    SearchApi,
    SearchDocument,
    Source,
    SourcesApi,
} from 'sailpoint-api-client'
import { TOKEN_URL_PATH } from './data/constants'
import { Config } from './model/config'
import { logger } from '@sailpoint/connector-sdk'

interface RetryConfig {
    maxRetries: number
    baseDelayMs: number
    maxDelayMs: number
}

interface RateLimitConfig {
    enabled: boolean
    maxCalls: number
    windowMs: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
}

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
    enabled: true,
    maxCalls: 100,
    windowMs: 10000, // 10 seconds
}

/**
 * Rate limiter using sliding window algorithm
 */
class RateLimiter {
    private callTimestamps: number[] = []
    private config: RateLimitConfig

    constructor(config: RateLimitConfig) {
        this.config = config
    }

    /**
     * Wait if necessary to respect rate limits
     */
    async waitIfNeeded(): Promise<void> {
        if (!this.config.enabled) {
            return
        }

        const now = Date.now()
        const windowStart = now - this.config.windowMs

        // Remove timestamps outside the current window
        this.callTimestamps = this.callTimestamps.filter((timestamp) => timestamp > windowStart)

        // Check if we're at the limit
        if (this.callTimestamps.length >= this.config.maxCalls) {
            const oldestCall = this.callTimestamps[0]
            const waitTime = oldestCall + this.config.windowMs - now
            
            if (waitTime > 0) {
                logger.warn(
                    `Rate limit reached (${this.callTimestamps.length}/${this.config.maxCalls} calls in ${this.config.windowMs}ms). Waiting ${waitTime}ms...`
                )
                await sleep(waitTime)
                // Recursively check again after waiting
                return this.waitIfNeeded()
            }
        }

        // Record this call
        this.callTimestamps.push(now)
    }

    /**
     * Get the current number of calls in the window
     */
    getCurrentCallCount(): number {
        const now = Date.now()
        const windowStart = now - this.config.windowMs
        this.callTimestamps = this.callTimestamps.filter((timestamp) => timestamp > windowStart)
        return this.callTimestamps.length
    }
}

/**
 * Determines if an error is retryable
 */
function isRetryableError(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return true
    }

    // HTTP status codes that should be retried
    const status = error.response?.status || error.status
    if (status === 429 || status === 503 || status === 504) {
        return true
    }

    // 5xx server errors (except 501 Not Implemented)
    if (status >= 500 && status < 600 && status !== 501) {
        return true
    }

    return false
}

/**
 * Get the retry delay from Retry-After header if present
 */
function getRetryAfterDelay(error: any): number | null {
    const retryAfter = error.response?.headers?.['retry-after']
    if (!retryAfter) {
        return null
    }

    // Retry-After can be in seconds or an HTTP date
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds)) {
        return seconds * 1000 // Convert to milliseconds
    }

    // Try to parse as date
    const date = new Date(retryAfter)
    if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now())
    }

    return null
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt)
    const jitter = Math.random() * 0.3 * exponentialDelay // 0-30% jitter
    return Math.min(exponentialDelay + jitter, config.maxDelayMs)
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry wrapper for async operations with exponential backoff and rate limiting
 */
async function withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
    rateLimiter?: RateLimiter
): Promise<T> {
    let lastError: any

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            // Wait for rate limit before attempting the operation
            if (rateLimiter) {
                await rateLimiter.waitIfNeeded()
            }

            if (attempt > 0) {
                logger.info(`Retry attempt ${attempt}/${config.maxRetries} for ${operationName}`)
            }
            return await operation()
        } catch (error: unknown) {
            lastError = error
            const err = error as any

            if (!isRetryableError(err)) {
                logger.debug(`Non-retryable error for ${operationName}: ${error}`)
                throw error
            }

            if (attempt < config.maxRetries) {
                const status = err.response?.status || err.status || 'unknown'
                
                // Check for Retry-After header (especially for 429 responses)
                const retryAfterDelay = getRetryAfterDelay(err)
                const delay = retryAfterDelay !== null ? retryAfterDelay : calculateDelay(attempt, config)
                
                const delaySource = retryAfterDelay !== null ? 'from Retry-After header' : 'exponential backoff'
                logger.warn(
                    `Retryable error for ${operationName} (status: ${status}). Retrying in ${Math.round(delay)}ms (${delaySource})... (attempt ${attempt + 1}/${config.maxRetries})`
                )
                await sleep(delay)
            } else {
                logger.error(`Max retries (${config.maxRetries}) reached for ${operationName}`)
            }
        }
    }

    throw lastError
}

export class ISCClient {
    private config: Configuration
    private retryConfig: RetryConfig
    private rateLimiter: RateLimiter

    constructor(
        config: Config,
        retryConfig?: Partial<RetryConfig>,
        rateLimitConfig?: Partial<RateLimitConfig>
    ) {
        const conf: ConfigurationParameters = {
            baseurl: config.baseurl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            tokenUrl: new URL(config.baseurl).origin + TOKEN_URL_PATH,
        }
        this.config = new Configuration(conf)
        this.config.experimental = true
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
        this.rateLimiter = new RateLimiter({ ...DEFAULT_RATE_LIMIT_CONFIG, ...rateLimitConfig })
        
        logger.info(
            `ISC Client initialized with rate limit: ${this.rateLimiter['config'].maxCalls} calls per ${this.rateLimiter['config'].windowMs}ms, retry config: ${JSON.stringify(this.retryConfig)}`
        )
    }

    async getPublicIdentityConfig(): Promise<PublicIdentityConfig> {
        return withRetry(
            async () => {
                const api = new PublicIdentitiesConfigApi(this.config)
                const response = await api.getPublicIdentityConfig()
                return response.data
            },
            'getPublicIdentityConfig',
            this.retryConfig,
            this.rateLimiter
        )
    }

    async listSources() {
        return withRetry(
            async () => {
                const api = new SourcesApi(this.config)
                const response = await Paginator.paginate(api, api.listSources)
                return response.data
            },
            'listSources',
            this.retryConfig,
            this.rateLimiter
        )
    }

    async getSource(id: string): Promise<Source> {
        return withRetry(
            async () => {
                const api = new SourcesApi(this.config)
                const response = await api.getSource({ id })
                return response.data
            },
            `getSource(${id})`,
            this.retryConfig,
            this.rateLimiter
        )
    }

    async patchSource(id: string, jsonPatch: JsonPatchOperation[]): Promise<Source> {
        return withRetry(
            async () => {
                const api = new SourcesApi(this.config)
                const response = await api.updateSource({ id, jsonPatchOperation: jsonPatch })
                return response.data
            },
            `patchSource(${id})`,
            this.retryConfig,
            this.rateLimiter
        )
    }

    async listAccountsBySource(id: string): Promise<Account[]> {
        return withRetry(
            async () => {
                const api = new AccountsApi(this.config)
                const filters = `sourceId eq "${id}"`
                const search = async (requestParameters?: AccountsApiListAccountsRequest | undefined) => {
                    return await api.listAccounts({ ...requestParameters, filters })
                }
                const response = await Paginator.paginate(api, search)
                return response.data
            },
            `listAccountsBySource(${id})`,
            this.retryConfig,
            this.rateLimiter
        )
    }

    async getSourceAccount(nativeIdentity: string, sourceId: string): Promise<Account | undefined> {
        return withRetry(
            async () => {
                const api = new AccountsApi(this.config)
                const filters = `sourceId eq "${sourceId}" and nativeIdentity eq "${nativeIdentity}"`
                const requestParameters: AccountsApiListAccountsRequest = {
                    filters,
                }
                const response = await api.listAccounts(requestParameters)
                return response.data[0]
            },
            `getSourceAccount(${nativeIdentity}, ${sourceId})`,
            this.retryConfig,
            this.rateLimiter
        )
    }

    async search(query: string, index: Index, includeNested: boolean = true): Promise<SearchDocument[]> {
        return withRetry(
            async () => {
                const api = new SearchApi(this.config)
                const search: Search = {
                    indices: [index],
                    query: {
                        query,
                    },
                    sort: ['id'],
                    includeNested,
                }
                const response = await Paginator.paginateSearchApi(api, search)
                return response.data as SearchDocument[]
            },
            `search(${query}, ${index})`,
            this.retryConfig,
            this.rateLimiter
        )
    }

    async getIdentity(id: string): Promise<IdentityDocument> {
        const response = await this.search(`id:${id}`, Index.Identities)

        if (response.length === 0) {
            throw new Error(`Identity not found: ${id}`)
        }

        return response[0] as IdentityDocument
    }

    async getIdentityByName(name: string): Promise<IdentityDocument> {
        const response = await this.search(`name.exact:"${name}"`, Index.Identities)

        if (response.length === 0) {
            throw new Error(`Identity not found: ${name}`)
        }

        return response[0] as IdentityDocument
    }
}
