import { Config } from '../model/config'
import { logger } from '@sailpoint/connector-sdk'
import { Mutex } from 'async-mutex'

interface CounterState {
    value: number
    version: number
    lastPatchedVersion: number
}

export class CounterService {
    private counters: Map<string, CounterState> = new Map()
    private isInitialized = false
    private initializationPromise: Promise<void> | null = null
    private mutex = new Mutex()
    private currentVersion = 0

    constructor(private readonly config: Config) {
        logger.debug(
            `CounterService initialized with config - hasCounters: ${!!config.counters}, counterKeys: ${
                config.counters ? Object.keys(config.counters).join(', ') : 'none'
            }`
        )
    }

    private async initialize(): Promise<void> {
        if (this.isInitialized) {
            logger.debug('CounterService already initialized')
            return
        }

        if (!this.initializationPromise) {
            this.initializationPromise = (async () => {
                try {
                    logger.debug('Initializing CounterService')
                    // Initialize counters from config if available
                    if (this.config.counters) {
                        for (const [key, value] of Object.entries(this.config.counters)) {
                            this.counters.set(key, {
                                value,
                                version: this.currentVersion++,
                                lastPatchedVersion: this.currentVersion - 1,
                            })
                            logger.debug(
                                `Initialized counter from config - key: ${key}, value: ${value}, version: ${
                                    this.currentVersion - 1
                                }`
                            )
                        }
                    }
                    this.isInitialized = true
                    logger.debug(
                        `CounterService initialization complete - counterCount: ${this.counters.size}, currentVersion: ${this.currentVersion}`
                    )
                } catch (error) {
                    logger.error('Failed to initialize counter:', error)
                    throw error
                }
            })()
        }

        await this.initializationPromise
    }

    private updateCounterFromConfig(id: string, config: Config): void {
        if (config.counters) {
            const configValue = config.counters[id as keyof typeof config.counters]
            if (typeof configValue === 'number') {
                const currentState = this.counters.get(id)
                const newVersion = this.currentVersion++

                logger.debug(
                    `Updating counter from config - id: ${id}, configValue: ${configValue}, currentValue: ${currentState?.value}, currentVersion: ${currentState?.version}, newVersion: ${newVersion}`
                )

                // Only update if we don't have a state or if the new value is higher
                if (!currentState || configValue > currentState.value) {
                    this.counters.set(id, {
                        value: configValue,
                        version: newVersion,
                        lastPatchedVersion: currentState?.lastPatchedVersion ?? 0,
                    })
                    logger.debug(
                        `Counter updated from config - id: ${id}, newValue: ${configValue}, newVersion: ${newVersion}, lastPatchedVersion: ${
                            currentState?.lastPatchedVersion ?? 0
                        }`
                    )
                } else {
                    logger.debug(
                        `Counter not updated from config - current value is higher - id: ${id}, configValue: ${configValue}, currentValue: ${currentState.value}`
                    )
                }
            }
        }
    }

    public async getNextCounter(id: string, config?: Config): Promise<number> {
        logger.debug(`Getting next counter - id: ${id}, hasConfig: ${!!config}`)
        await this.initialize()

        if (config) {
            this.updateCounterFromConfig(id, config)
        }

        return await this.mutex.runExclusive(async () => {
            const currentState = this.counters.get(id)
            const currentValue = currentState?.value ?? 0
            const newVersion = this.currentVersion++

            logger.debug(
                `Incrementing counter - id: ${id}, currentValue: ${currentValue}, newValue: ${
                    currentValue + 1
                }, currentVersion: ${currentState?.version}, newVersion: ${newVersion}`
            )

            this.counters.set(id, {
                value: currentValue + 1,
                version: newVersion,
                lastPatchedVersion: currentState?.lastPatchedVersion ?? 0,
            })
            return currentValue
        })
    }

    public async getCurrentCounter(id: string, config?: Config): Promise<number> {
        logger.debug(`Getting current counter - id: ${id}, hasConfig: ${!!config}`)
        await this.initialize()

        if (config) {
            this.updateCounterFromConfig(id, config)
        }

        const value = this.counters.get(id)?.value ?? 0
        logger.debug(`Current counter value - id: ${id}, value: ${value}`)
        return value
    }

    public getPendingPatches(): Map<string, number> {
        logger.debug('Getting pending patches')
        const patches = new Map<string, number>()
        for (const [key, state] of this.counters.entries()) {
            // Only include counters that have been updated since last patch
            if (state.version > state.lastPatchedVersion) {
                patches.set(key, state.value)
                // Update the lastPatchedVersion to current version
                state.lastPatchedVersion = state.version
                logger.debug(
                    `Added pending patch - key: ${key}, value: ${state.value}, version: ${state.version}, lastPatchedVersion: ${state.lastPatchedVersion}`
                )
            }
        }
        logger.debug(`Pending patches complete - patchCount: ${patches.size}`)
        return patches
    }

    public getCounterVersions(): Map<string, { current: number; lastPatched: number }> {
        logger.debug('Getting counter versions')
        const versions = new Map<string, { current: number; lastPatched: number }>()
        for (const [key, state] of this.counters.entries()) {
            versions.set(key, {
                current: state.version,
                lastPatched: state.lastPatchedVersion,
            })
            logger.debug(
                `Counter version info - key: ${key}, currentVersion: ${state.version}, lastPatchedVersion: ${state.lastPatchedVersion}`
            )
        }
        return versions
    }
}
