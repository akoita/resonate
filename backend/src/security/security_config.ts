export interface SecurityConfig {
  jwtTtlSeconds: number;
  maxUploadSizeMb: number;
  confirmationDepth: number;
  enableAuditLogs: boolean;
}

export const defaultSecurityConfig: SecurityConfig = {
  jwtTtlSeconds: 900,
  maxUploadSizeMb: 200,
  confirmationDepth: 12,
  enableAuditLogs: true,
};
