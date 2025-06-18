import { transliterate } from 'transliteration'
import velocityjs from 'velocityjs'
import { RenderContext } from 'velocityjs/dist/src/type'

export const normalize = (str: string): string => {
    let result = transliterate(str)
    result = result.replace(/'/g, '')

    return result
}

export const removeSpaces = (str: string): string => {
    return str.replace(/\s/g, '')
}

export const switchCase = (str: string, caseType: 'lower' | 'upper' | 'capitalize' | 'same'): string => {
    switch (caseType) {
        case 'lower':
            return str.toLowerCase()
        case 'upper':
            return str.toUpperCase()
        case 'capitalize':
            return str
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ')
        default:
            return str
    }
}

export const evaluateVelocityTemplate = (expression: string, context: RenderContext): string | undefined => {
    const template = velocityjs.parse(expression)
    const velocity = new velocityjs.Compile(template)
    const result = velocity.render(context)

    return result
}

export const templateHasVariable = (expression: string, variable: string): boolean => {
    const template = velocityjs.parse(expression)
    return template.find((x) => (x as any).id === variable) ? true : false
}

export const padNumber = (number: number, length: number): string => {
    const numStr = number.toString()
    return numStr.length < length ? numStr.padStart(length, '0') : numStr
}
