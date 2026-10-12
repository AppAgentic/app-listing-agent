import { ROLE_PERMISSIONS } from '../firebase/firestore'

export type Role = 'owner' | 'admin' | 'member' | 'viewer'

export type Permission =
  | 'canCreateProjects'
  | 'canDeleteProjects'
  | 'canManageCredentials'
  | 'canInviteMembers'
  | 'canViewAuditLog'

export interface RolePermissions {
  canCreateProjects: boolean
  canDeleteProjects: boolean
  canManageCredentials: boolean
  canInviteMembers: boolean
  canViewAuditLog: boolean
}

/**
 * Get default permissions for a role
 */
export function getDefaultPermissions(role: Role): RolePermissions {
  return { ...ROLE_PERMISSIONS[role] }
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role][permission]
}

/**
 * Check if a role can manage another role
 * - Owner can manage all roles
 * - Admin can manage member and viewer
 * - Member and viewer cannot manage anyone
 */
export function canManageRole(managerRole: Role, targetRole: Role): boolean {
  const hierarchy: Record<Role, number> = {
    owner: 4,
    admin: 3,
    member: 2,
    viewer: 1
  }

  // Owner can manage everyone except other owners
  if (managerRole === 'owner') {
    return targetRole !== 'owner'
  }

  // Admin can manage member and viewer
  if (managerRole === 'admin') {
    return hierarchy[targetRole] < hierarchy['admin']
  }

  // Others cannot manage anyone
  return false
}

/**
 * Check if a user can assign a specific role
 * - Owner can assign any role except owner
 * - Admin can assign member or viewer
 * - Others cannot assign roles
 */
export function canAssignRole(assignerRole: Role, targetRole: Role): boolean {
  if (assignerRole === 'owner') {
    return targetRole !== 'owner' // Can't create more owners
  }

  if (assignerRole === 'admin') {
    return targetRole === 'member' || targetRole === 'viewer'
  }

  return false
}

/**
 * Get all roles that a user can assign to others
 */
export function getAssignableRoles(role: Role): Role[] {
  if (role === 'owner') {
    return ['admin', 'member', 'viewer']
  }

  if (role === 'admin') {
    return ['member', 'viewer']
  }

  return []
}

/**
 * Validate that custom permissions don't exceed role defaults
 */
export function validateCustomPermissions(
  role: Role,
  customPermissions: Partial<RolePermissions>
): boolean {
  const defaults = getDefaultPermissions(role)

  for (const [key, value] of Object.entries(customPermissions)) {
    const permission = key as Permission
    // Custom permission can only be false if default is true
    // Cannot grant more permissions than the role allows
    if (value === true && !defaults[permission]) {
      return false
    }
  }

  return true
}

/**
 * Merge custom permissions with role defaults
 * Custom permissions can only restrict, not expand
 */
export function mergePermissions(
  role: Role,
  customPermissions?: Partial<RolePermissions>
): RolePermissions {
  const defaults = getDefaultPermissions(role)

  if (!customPermissions) {
    return defaults
  }

  const merged = { ...defaults }

  for (const [key, value] of Object.entries(customPermissions)) {
    const permission = key as Permission
    // Can only restrict (set to false) if default is true
    if (value === false && defaults[permission] === true) {
      merged[permission] = false
    }
  }

  return merged
}

/**
 * Alias for getDefaultPermissions (backwards compatibility)
 */
export const getPermissionsForRole = getDefaultPermissions

/**
 * Get human-readable role display name
 */
export function getRoleDisplayName(role: Role): string {
  const names: Record<Role, string> = {
    owner: 'Owner',
    admin: 'Admin',
    member: 'Member',
    viewer: 'Viewer'
  }
  return names[role]
}

/**
 * Get role description
 */
export function getRoleDescription(role: Role): string {
  const descriptions: Record<Role, string> = {
    owner: 'Full access to all features and billing',
    admin: 'Manage projects, members, and credentials',
    member: 'Create projects and run translations',
    viewer: 'View-only access to projects'
  }
  return descriptions[role]
}
