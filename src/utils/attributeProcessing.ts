import { RenderContext } from 'velocityjs/dist/src/type'
import { Attribute } from '../model/config'
import {
    evaluateVelocityTemplate,
    normalize,
    padNumber,
    removeSpaces,
    switchCase,
    templateHasVariable,
} from './formatting'
import { logger } from '@sailpoint/connector-sdk'

export class StateWrapper {
    constructor(public state: Map<string, number>) {}

    static getCounter(): () => number {
        let counter = 0
        return () => {
            counter++
            return counter
        }
    }

    getCounter(key: string, persist: boolean = false): () => number {
        if (persist) {
            return () => {
                const currentValue = this.state.get(key) ?? 0
                this.state.set(key, currentValue + 1)
                return currentValue
            }
        } else {
            return StateWrapper.getCounter()
        }
    }
}

export const processAttributeDefinition = (
    definition: Attribute,
    attributes: RenderContext,
    counter: () => number,
    values: string[] = []
): string | undefined => {
    let value = evaluateVelocityTemplate(definition.expression, attributes)
    if (value) {
        logger.debug(`Template evaluation result - attributeName: ${definition.name}, rawValue: ${value}`)

        value = switchCase(value, definition.case)
        if (definition.spaces) {
            value = removeSpaces(value)
        }
        if (definition.normalize) {
            value = normalize(value)
        }
        logger.debug(
            `Final attribute value after transformations - attributeName: ${definition.name}, finalValue: ${value}, transformations: case=${definition.case}, spaces=${definition.spaces}, normalize=${definition.normalize}`
        )
    } else {
        logger.error(`Failed to evaluate velocity template for attribute ${definition.name}`)
        return
    }

    return value
}

export const buildAttribute = (
    definition: Attribute,
    attributes: RenderContext,
    counter: () => number,
    values: any[] = []
): string | undefined => {
    if (definition.counter) {
        if (counter) {
            attributes.counter = padNumber(counter(), definition.digits)
        } else {
            logger.error(`Counter is required for attribute ${definition.name}`)
            return
        }
    }

    if (definition.unique) {
        attributes.counter = ''
    }

    let value = processAttributeDefinition(definition, attributes, counter, values)

    if (definition.unique) {
        if (!templateHasVariable(definition.expression, 'counter')) {
            definition.expression = definition.expression + '$counter'
        }
        while (value && values?.includes(value)) {
            attributes.counter = padNumber(counter(), definition.digits)
            value = processAttributeDefinition(definition, attributes, counter, values)
        }
        values?.push(value)
    }

    return value
}
