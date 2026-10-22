// Auth (CONTRACT.md → Auth)
export interface AuthUser { id: string; email: string }
export interface AuthSession { token: string; expiresAt: string; user: AuthUser }
export interface AuthStatus { hasUsers: boolean }
