import {
    createConnector,
    readConfig,
    logger,
    StdTestConnectionHandler,
    ConnectorError,
    StdAccountDiscoverSchemaHandler,
    AccountSchema,
    StdAccountListHandler,
    StdAccountReadHandler,
} from '@sailpoint/connector-sdk'
import { ISCClient } from './isc-client'
import { Config } from './model/config'
import spec from '../connector-spec.json'
import { IdentityDocument, Index } from 'sailpoint-api-client'
import { buildAttribute, StateWrapper } from './utils/attributeProcessing'
import { Account } from './model/account'

// Connector must be exported as module property named connector
export const connector = async () => {
    // Get connector source config
    let config: Config = await readConfig()
    const attributes = config.attributes ?? []
    //logger.level = 'debug'

    // Use the vendor SDK, or implement own client as necessary, to initialize a client
    const isc = new ISCClient(config)
    const sources = await isc.listSources()
    const source = sources.find(
        (x) => (x as any).connectorAttributes.spConnectorInstanceId === config.spConnectorInstanceId
    )!
    const sourceId = source.id

    const stdTestConnection: StdTestConnectionHandler = async (context, input, res) => {
        try {
            await isc.getPublicIdentityConfig()
            res.send({})
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(error as string)
        }
    }

    const stdAccountDiscoverSchema: StdAccountDiscoverSchemaHandler = async (context, input, res) => {
        const schema: AccountSchema = spec.accountSchema

        for (const attribute of attributes) {
            schema.attributes.push({
                name: attribute.name,
                type: 'string',
                description: attribute.name,
            })
        }

        res.send(schema)
    }

    const stdAccountList: StdAccountListHandler = async (context, input, res) => {
        const stateWrapper = new StateWrapper((input.state as Map<string, number>) ?? new Map())

        const uniqueAttributes = attributes.filter((x) => x.unique).map((x) => x.name)
        const valuesMap = new Map<string, string[]>()

        try {
            const identities = (await isc.search(config.search, Index.Identities)) as IdentityDocument[]
            const accountsMap = new Map(
                identities.map((x) => {
                    return [x.id, x.accounts?.find((y) => y.source?.id === sourceId)?.accountAttributes]
                })
            )
            for (const attribute of uniqueAttributes) {
                const values = identities.map((x) => x.attributes?.[attribute]).filter((x) => x)
                valuesMap.set(attribute, values)
            }

            for (const definition of attributes) {
                for (const identity of identities) {
                    let account = accountsMap.get(identity.id)
                    if (definition.refresh || !account || !account[definition.name]) {
                        if (!account) {
                            account = {
                                id: identity.id,
                                name: identity.name,
                            }
                            accountsMap.set(identity.id, account)
                        }
                        if (identity.attributes) {
                            account![definition.name] = buildAttribute(
                                definition,
                                identity.attributes,
                                stateWrapper.getCounter(definition.name, definition.counter),
                                valuesMap.get(definition.name)
                            )
                        } else {
                            throw new ConnectorError(`Identity ${identity.id} has no attributes`)
                        }
                    }
                }
            }

            for (const accountAttributes of accountsMap.values()) {
                if (accountAttributes) {
                    const account = new Account(accountAttributes)
                    logger.info(account)
                    res.send(account)
                }

                res.saveState(stateWrapper.state)
            }
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(error as string)
        }
    }

    const stdAccountRead: StdAccountReadHandler = async (context, input, res) => {
        const identity = await isc.getIdentity(input.identity)
        let accountAttributes = identity.accounts?.find((x) => x.source?.id === sourceId)?.accountAttributes!

        for (const definition of attributes) {
            if (definition.refresh || !accountAttributes[definition.name]) {
                if (!accountAttributes) {
                    accountAttributes = {
                        id: identity.id,
                        name: identity.name,
                    }
                }
                if (identity.attributes) {
                    accountAttributes![definition.name] = buildAttribute(
                        definition,
                        identity.attributes,
                        StateWrapper.getCounter()
                    )
                } else {
                    throw new ConnectorError(`Identity ${identity.id} has no attributes`)
                }
            }
        }

        const account = new Account(accountAttributes)
        logger.info(account)
        res.send(account)
    }

    /* const stdCreateAccount: StdAccountCreateHandler = async (context, input, res) => {
        logger.info(input)
        const counters = new Map<string, number>()
        const name = input.attributes.name
        const account: StdAccountCreateOutput = {
            attributes: input.attributes,
            uuid: name,
            identity: name,
        }
        logger.debug(
            `Processing account creation with counters - name: ${name}, attributeCount: ${
                attributes.length
            }, attributesWithCounters: ${attributes
                .filter((a) => a.counter)
                .map((a) => a.name)
                .join(', ')}`
        )

        for (const attribute of attributes) {
            if (attribute.counter) {
                logger.debug(
                    `Processing counter attribute - name: ${attribute.name}, digits: ${attribute.digits}, expression: ${attribute.expression}`
                )

                const counterValue = await counterService.getNextCounter(attribute.name, config)
                counters.set(attribute.name, counterValue)
                logger.debug(
                    `Got next counter value - attributeName: ${
                        attribute.name
                    }, counterValue: ${counterValue}, paddedValue: ${padNumber(counterValue, attribute.digits)}`
                )

                let counter
                if (counterValue === 0 && attribute.omit) {
                    counter = ''
                } else {
                    counter = padNumber(counterValue, attribute.digits)
                }
                const context: RenderContext = {
                    ...input.attributes,
                    counter,
                }
                if (!templateHasCounter(attribute.expression)) {
                    logger.debug(
                        `Adding counter to expression - attributeName: ${attribute.name}, originalExpression: ${attribute.expression}, newExpression: ${attribute.expression}$counter`
                    )
                    attribute.expression = attribute.expression + '$counter'
                }
                let value = evaluateVelocityTemplate(attribute.expression, context)
                if (value) {
                    logger.debug(`Template evaluation result - attributeName: ${attribute.name}, rawValue: ${value}`)

                    value = switchCase(value, attribute.case)
                    if (attribute.spaces) {
                        value = removeSpaces(value)
                    }
                    if (attribute.normalize) {
                        value = normalize(value)
                    }
                    logger.debug(
                        `Final attribute value after transformations - attributeName: ${attribute.name}, finalValue: ${value}, transformations: case=${attribute.case}, spaces=${attribute.spaces}, normalize=${attribute.normalize}`
                    )
                } else {
                    logger.error(`Failed to evaluate velocity template for attribute ${attribute.name}`)
                }

                account.attributes[attribute.name] = value
            }
        }

        // Get pending patches
        logger.debug('Getting pending counter patches')
        const pendingPatches = counterService.getPendingPatches()
        logger.debug(
            `Pending patches retrieved - patchCount: ${pendingPatches.size}, patches: ${Array.from(
                pendingPatches.entries()
            )
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')}`
        )

        // Create patches array
        const patches: Patch[] = []
        for (const [key, value] of pendingPatches) {
            const patch: Patch = {
                op: PatchOp.Replace,
                path: `/counters/${key}`,
                value,
            }
            patches.push(patch)
            logger.debug(`Created patch - key: ${key}, value: ${value}, path: ${patch.path}`)
        }

        // Apply patches
        logger.debug(
            `Applying counter patches to config - patchCount: ${patches.length}, patches: ${patches
                .map((p) => `${p.path}=${p.value}`)
                .join(', ')}`
        )
        res.patchConfig(patches)
        logger.debug(patches)
        logger.debug('Counter patches applied successfully')

        logger.debug(account)
        res.send(account)
    } */

    /*     const stdEntitlementList: StdEntitlementListHandler = async (context, input, res) => {
        logger.info(input)
        logger.debug(baseEntitlement)
        res.send(baseEntitlement)
    } */

    return (
        createConnector()
            .stdTestConnection(stdTestConnection)
            //.stdAccountCreate(stdCreateAccount)
            .stdAccountList(stdAccountList)
            .stdAccountRead(stdAccountRead)
            //.stdEntitlementList(stdEntitlementList)
            .stdAccountDiscoverSchema(stdAccountDiscoverSchema)
    )
}
