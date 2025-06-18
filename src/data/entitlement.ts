import { StdEntitlementListOutput } from '@sailpoint/connector-sdk'

export const baseEntitlement: StdEntitlementListOutput = {
    type: 'group',
    uuid: 'Account',
    identity: 'account',
    attributes: {
        id: 'account',
        name: 'Account',
        description: 'Assign to generate account attributes',
    },
}
