import {
    AccessProfileDetailsV2025,
    AccessProfilesV2025Api,
    AccessProfilesV2025ApiCreateAccessProfileRequest,
    AccessProfilesV2025ApiListAccessProfilesRequest,
    AccessProfilesV2025ApiPatchAccessProfileRequest,
    AccessProfileV2025,
    AppsV2025Api,
    AppsV2025ApiCreateSourceAppRequest,
    AppsV2025ApiDeleteAccessProfilesFromSourceAppByBulkRequest,
    AppsV2025ApiGetSourceAppRequest,
    AppsV2025ApiListAccessProfilesForSourceAppRequest,
    AppsV2025ApiListAllSourceAppRequest,
    AppsV2025ApiPatchSourceAppRequest,
    Configuration,
    ConfigurationParameters,
    EntitlementRefV2025,
    EntitlementsV2025Api,
    EntitlementsV2025ApiListEntitlementsRequest,
    EntitlementV2025,
    IdentityDocument,
    Index,
    JsonPatchOperationV2025,
    Paginator,
    PublicIdentitiesConfigApi,
    PublicIdentityConfig,
    RequestabilityForRoleV2025,
    RequestabilityV2025,
    RoleMembershipSelectorV2025,
    RolesV2025Api,
    RolesV2025ApiCreateRoleRequest,
    RolesV2025ApiListRolesRequest,
    RolesV2025ApiPatchRoleRequest,
    RoleV2025,
    Search,
    SearchApi,
    SearchDocument,
    SourceAppV2025,
    SourcesApi,
    SourcesV2025Api,
} from 'sailpoint-api-client'
import { TOKEN_URL_PATH } from './data/constants'
import { Config } from './model/config'

export class ISCClient {
    private config: Configuration

    constructor(config: Config) {
        const conf: ConfigurationParameters = {
            baseurl: config.baseurl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            tokenUrl: new URL(config.baseurl).origin + TOKEN_URL_PATH,
        }
        this.config = new Configuration(conf)
        this.config.experimental = true
    }

    async getPublicIdentityConfig(): Promise<PublicIdentityConfig> {
        const api = new PublicIdentitiesConfigApi(this.config)

        const response = await api.getPublicIdentityConfig()

        return response.data
    }

    async listSources() {
        const api = new SourcesApi(this.config)

        const response = await Paginator.paginate(api, api.listSources)

        return response.data
    }

    async search(query: string, index: Index): Promise<SearchDocument[]> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: [index],
            query: {
                query,
            },
            sort: ['id'],
            includeNested: true,
        }

        const response = await Paginator.paginateSearchApi(api, search)
        return response.data as SearchDocument[]
    }

    async listEntitlements(filters: string): Promise<EntitlementV2025[]> {
        const api = new EntitlementsV2025Api(this.config)
        const requestParameters: EntitlementsV2025ApiListEntitlementsRequest = {
            filters,
        }
        const listEntitlements = () => {
            return api.listEntitlements(requestParameters)
        }

        const response = await Paginator.paginate(api, listEntitlements)
        return response.data
    }

    async getAccessProfileByName(name: string): Promise<AccessProfileV2025 | undefined> {
        const api = new AccessProfilesV2025Api(this.config)
        const filters = `name eq "${name}"`
        const requestParameters: AccessProfilesV2025ApiListAccessProfilesRequest = {
            filters,
        }
        const response = await api.listAccessProfiles(requestParameters)
        return response.data[0] ? response.data[0] : undefined
    }

    async getRoleByName(name: string): Promise<RoleV2025 | undefined> {
        const api = new RolesV2025Api(this.config)
        const filters = `name eq "${name}"`
        const requestParameters: RolesV2025ApiListRolesRequest = {
            filters,
        }
        const response = await api.listRoles(requestParameters)
        return response.data[0] ? response.data[0] : undefined
    }

    async getAppByName(name: string): Promise<SourceAppV2025 | undefined> {
        const api = new AppsV2025Api(this.config)
        const filters = `name eq "${name}"`
        const requestParameters: AppsV2025ApiListAllSourceAppRequest = {
            filters,
        }

        const response = await api.listAllSourceApp(requestParameters)
        return response.data[0] ? response.data[0] : undefined
    }

    async createApp(name: string, sourceId: string): Promise<SourceAppV2025> {
        const api = new AppsV2025Api(this.config)
        const requestParameters: AppsV2025ApiCreateSourceAppRequest = {
            sourceAppCreateDtoV2025: {
                name,
                description: name,
                accountSource: {
                    id: sourceId,
                },
            },
            xSailPointExperimental: 'true',
        }
        const response = await api.createSourceApp(requestParameters)
        return response.data
    }

    async updateSourceAccessProfiles(
        id: string,
        jsonPatchOperationV2025: JsonPatchOperationV2025[]
    ): Promise<SourceAppV2025> {
        const api = new AppsV2025Api(this.config)

        const requestParameters: AppsV2025ApiPatchSourceAppRequest = {
            id,
            jsonPatchOperationV2025,
            xSailPointExperimental: 'true',
        }
        const response = await api.patchSourceApp(requestParameters)
        return response.data
    }

    async removeSourceAccessProfiles(id: string, accessProfileIds: string[]): Promise<AccessProfileDetailsV2025[]> {
        const api = new AppsV2025Api(this.config)

        const requestParameters: AppsV2025ApiDeleteAccessProfilesFromSourceAppByBulkRequest = {
            id,
            requestBody: accessProfileIds,
            xSailPointExperimental: 'true',
        }
        const response = await api.deleteAccessProfilesFromSourceAppByBulk(requestParameters)
        return response.data
    }

    async listSourceAccessProfiles(id: string): Promise<AccessProfileDetailsV2025[]> {
        const api = new AppsV2025Api(this.config)
        const requestParameters: AppsV2025ApiListAccessProfilesForSourceAppRequest = {
            id,
        }
        const response = await api.listAccessProfilesForSourceApp(requestParameters)
        return response.data
    }

    async getSource(id: string): Promise<SourceAppV2025> {
        const api = new SourcesV2025Api(this.config)
        const requestParameters: AppsV2025ApiGetSourceAppRequest = {
            id,
        }
        const response = await api.getSource(requestParameters)
        return response.data
    }

    async createAccessProfile(
        name: string,
        ownerId: string,
        sourceId: string,
        entitlements: EntitlementRefV2025[],
        requestable: boolean = false,
        accessRequestConfig?: RequestabilityV2025
    ): Promise<AccessProfileV2025> {
        const api = new AccessProfilesV2025Api(this.config)
        const requestParameters: AccessProfilesV2025ApiCreateAccessProfileRequest = {
            accessProfileV2025: {
                name,
                description: name,
                owner: {
                    id: ownerId,
                    type: 'IDENTITY',
                },
                source: {
                    id: sourceId,
                },
                enabled: true,
                entitlements,
                requestable,
            },
        }
        if (accessRequestConfig) requestParameters.accessProfileV2025.accessRequestConfig = accessRequestConfig
        const response = await api.createAccessProfile(requestParameters)
        return response.data
    }

    async updateAccessProfile(
        id: string,
        jsonPatchOperationV2025: JsonPatchOperationV2025[]
    ): Promise<AccessProfileV2025> {
        const api = new AccessProfilesV2025Api(this.config)
        const requestParameters: AccessProfilesV2025ApiPatchAccessProfileRequest = {
            id,
            jsonPatchOperationV2025,
        }
        const response = await api.patchAccessProfile(requestParameters)
        return response.data
    }

    async createRole(
        name: string,
        ownerId: string,
        entitlements: EntitlementRefV2025[],
        requestable: boolean = false,
        accessRequestConfig?: RequestabilityForRoleV2025,
        membership?: RoleMembershipSelectorV2025
    ): Promise<RoleV2025> {
        const api = new RolesV2025Api(this.config)
        const requestParameters: RolesV2025ApiCreateRoleRequest = {
            roleV2025: {
                name,
                description: name,
                owner: {
                    id: ownerId,
                    type: 'IDENTITY',
                },
                requestable,
                entitlements,
                accessRequestConfig,
                enabled: true,
            },
        }
        if (accessRequestConfig) requestParameters.roleV2025.accessRequestConfig = accessRequestConfig
        if (membership) requestParameters.roleV2025.membership = membership
        const response = await api.createRole(requestParameters)
        return response.data
    }

    async updateRole(id: string, jsonPatchOperationV2025: JsonPatchOperationV2025[]): Promise<RoleV2025> {
        const api = new RolesV2025Api(this.config)
        const requestParameters: RolesV2025ApiPatchRoleRequest = {
            id,
            jsonPatchOperationV2025,
        }
        const response = await api.patchRole(requestParameters)
        return response.data
    }

    async getIdentity(id: string): Promise<IdentityDocument> {
        const response = await this.search(`id:${id}`, Index.Identities)

        return response[0] as IdentityDocument
    }
}
