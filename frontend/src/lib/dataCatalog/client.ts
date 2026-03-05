import { ApiClient } from "@/shared/apiClient";
import { API_BASE_URL } from "@/shared/config";

export const backendClient = new ApiClient(API_BASE_URL);

export async function get<T>(endpoint: string): Promise<T> {
  return backendClient.get<T>(endpoint);
}

export async function post<T>(endpoint: string, body: unknown): Promise<T> {
  return backendClient.post<T>(endpoint, body);
}

export async function patch<T>(endpoint: string, body: unknown): Promise<T> {
  return backendClient.patch<T>(endpoint, body);
}

export async function del<T = void>(endpoint: string): Promise<T> {
  return backendClient.del<T>(endpoint);
}

export async function uploadFile<T>(
  endpoint: string,
  file: File,
  additionalFields: Record<string, string>
): Promise<T> {
  return backendClient.uploadFile<T>(endpoint, file, additionalFields);
}
