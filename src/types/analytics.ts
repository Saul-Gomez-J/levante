export interface SupabaseConfig {
    url: string;
    anonKey: string;
}

export interface UserRecord {
    user_id: string;
    first_seen_at?: string;
    last_seen_at?: string;
    sharing_data: boolean;
    updated_at?: string;
}

export interface AppOpenRecord {
    user_id: string;
    opened_at?: string;
    app_version: string;
    platform: string;
}

export interface ConversationRecord {
    user_id: string;
    created_at?: string;
}

export interface MCPUsageRecord {
    user_id: string;
    mcp_name: string;
    status: 'active' | 'removed';
    event_at?: string;
}

export interface ProviderStatsRecord {
    user_id: string;
    provider_name: string;
    active_models_count: number;
    recorded_at?: string;
}

export interface RuntimeUsageRecord {
    user_id: string;
    runtime_type: 'node' | 'python';
    runtime_version: string;
    runtime_source: 'system' | 'shared';
    action: 'installed' | 'used';
    mcp_server_id?: string;
    event_at?: string;
}
