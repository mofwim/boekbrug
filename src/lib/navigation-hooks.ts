'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { getParentPath, getHomePath, type Role } from './navigation'

export function useParentPath(role: Role): string {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return getParentPath(pathname, role, searchParams)
}

export function useHomePath(role: Role): string {
  return getHomePath(role)
}