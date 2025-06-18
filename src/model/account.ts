import { Attributes, Key, SimpleKey, StdAccountListOutput } from '@sailpoint/connector-sdk'

export class Account implements StdAccountListOutput {
    disabled?: boolean | undefined
    locked?: boolean | undefined
    deleted?: boolean | undefined
    incomplete?: boolean | undefined
    finalUpdate?: boolean | undefined
    key: Key

    constructor(public attributes: Attributes) {
        this.key = {
            simple: {
                id: attributes.id as string,
            },
        }
        this.disabled = false
    }
}
