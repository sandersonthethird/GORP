export interface WebShareResult {
  success: true
  url: string
  token: string
}

export interface WebShareError {
  success: false
  error: 'no_transcript' | 'no_api_key' | 'upload_failed' | 'network_error'
  message: string
}

export type WebShareResponse = WebShareResult | WebShareError
