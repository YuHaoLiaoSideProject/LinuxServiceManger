import axios from 'axios'
import type { Service, LoginResponse, SessionInfo, MessageResponse } from '../types/service'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
})

// Auth
export async function login(username: string, password: string): Promise<LoginResponse> {
  const params = new URLSearchParams({ username, password })
  const { data } = await api.post<LoginResponse>('/login', params)
  return data
}

export async function logout(): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/logout')
  return data
}

export async function checkSession(): Promise<SessionInfo> {
  const { data } = await api.get<SessionInfo>('/session')
  return data
}

// Services
export async function listServices(): Promise<Service[]> {
  const { data } = await api.get<Service[]>('/services')
  return data
}

export async function startService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/start`)
  return data
}

export async function stopService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/stop`)
  return data
}

export async function restartService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/restart`)
  return data
}
