import { describe,it,expect } from 'vitest'; import { allowedContentType,isPrivateAddress,parsePublicHttpUrl,resolvePublic } from './feed-policy.mjs';
describe('feed SSRF policy',()=>{
it.each(['127.0.0.1','10.0.0.1','169.254.1.1','192.168.1.1','::1','fc00::1','fe80::1'])('blocks private %s',ip=>expect(isPrivateAddress(ip)).toBe(true));
it('blocks credentials and unsafe ports',()=>{expect(()=>parsePublicHttpUrl('http://a:b@example.com/rss')).toThrow('credentials');expect(()=>parsePublicHttpUrl('http://example.com:8080/rss')).toThrow('ports');});
it('rejects a hostname when any answer is private',async()=>{await expect(resolvePublic(new URL('https://example.com/feed'),async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}])).rejects.toThrow('private');});
it('allows feed types and html pages, rejects other types',()=>{for(const t of ['application/rss+xml','application/atom+xml','text/xml','application/xml','text/html; charset=utf-8','text/plain','application/feed+json','application/json; charset=utf-8'])expect(allowedContentType(t)).toBe(true);for(const t of ['application/jsonp','image/png','video/mp4'])expect(allowedContentType(t)).toBe(false);});
});
