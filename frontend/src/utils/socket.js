import { io } from 'socket.io-client'
import { getToken } from '../api/http'

export function createSocket() {
  return io('/', {
    transports: ['websocket'],
    auth: { token: getToken() }
  })
}
