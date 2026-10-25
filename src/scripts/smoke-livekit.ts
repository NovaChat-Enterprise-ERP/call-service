import { LiveKitVideoProvider } from '../providers/video-provider.js';

const video = new LiveKitVideoProvider(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
const room = `nc-smoke-${Date.now()}`;
await video.ensureRoom(room);
console.log('room active:', (await video.activeRooms()).has(room));
const token = await video.createJoinToken({ room, identity: 'smoke', name: 'Smoke Test', admin: true });
console.log('token segments:', token.split('.').length);
console.log('participants:', await video.listParticipants(room));
await video.closeRoom(room);
console.log('room after close:', (await video.activeRooms()).has(room));
