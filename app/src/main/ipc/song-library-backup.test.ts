// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { c as createTar, x as extractTar, Header } from 'tar';
import { SongLibraryStore } from './song-library-store';
import type { LibrarySong } from '../../shared/song-library';

let temp:string,root:string,archive:string,store:SongLibraryStore;
const pcm=new Uint8Array(new Float32Array([0,.25,-.5,1]).buffer);
const song=():LibrarySong=>({id:randomUUID(),title:'Demo song',artist:'Demo band',sourceName:'demo.wav',duration:4/44100,audio:[{name:'source',sampleRate:44100,frames:4,channels:1},{name:'guitar',sampleRate:44100,frames:4,channels:2}],settings:{'':'[00:00] [C] Demo {midi:pc 1 20}',':lyrics':'[00:00] Original demo words',':bpm':'120',':options':JSON.stringify({songKey:'C major',mix:{guitar:{volume:.5,mute:false}}})},updated:new Date().toISOString()});
async function save(target:SongLibraryStore,s:LibrarySong){const token=await target.begin(s);for(const track of s.audio)for(let c=0;c<track.channels;c++)await target.write(token,`${track.name}-${c}.f32`,pcm);await target.commit(token);}
async function unpack(){const dir=join(temp,randomUUID());await mkdir(dir);await extractTar({cwd:dir,file:archive,strict:true,maxDecompressionRatio:2048});return dir;}
async function repack(dir:string,omit?:string){const index=JSON.parse(await readFile(join(dir,'library.json'),'utf8'));const files=['backup-manifest.json','library.json',...Object.values(index.revisions).flatMap(rev=>['source-0.f32','guitar-0.f32','guitar-1.f32'].map(name=>`${rev}/${name}`))].filter(p=>p!==omit);await createTar({cwd:dir,file:archive,gzip:true,portable:true},files);}
beforeEach(async()=>{temp=await mkdtemp(join(tmpdir(),'vltn-backup-test-'));root=join(temp,'library');archive=join(temp,'portable.tar.gz');store=new SongLibraryStore(root);});
afterEach(async()=>{await rm(temp,{recursive:true,force:true});});
it('round-trips all audio/settings and repeated playlist entries as new copies without replacing existing songs',async()=>{
  const first=song(),second={...song(),title:'Second demo'};await save(store,first);await save(store,second);
  await store.playlists([{id:randomUUID(),name:'Demo set',songs:[first.id,second.id,first.id]}]);
  const progress:unknown[]=[];await store.exportBackup(archive,p=>progress.push(p));expect(progress.length).toBeGreaterThan(1);
  const restored=new SongLibraryStore(join(temp,'restored')),existing=song();await save(restored,existing);
  expect(await restored.restoreBackup(archive)).toEqual({songs:2,playlists:1});
  const index=await new SongLibraryStore(join(temp,'restored')).index();
  expect(index.songs[0]).toEqual(existing);
  expect(index.songs[1]).toEqual({...first,id:index.songs[1].id});expect(index.songs[1].id).not.toBe(first.id);
  expect(index.playlists[0].songs).toEqual([index.songs[1].id,index.songs[2].id,index.songs[1].id]);
  for(const name of ['source-0.f32','guitar-0.f32','guitar-1.f32'])expect(await restored.audio(index.songs[1].id,name)).toEqual(pcm);
  await restored.restoreBackup(archive);expect((await restored.index()).songs).toHaveLength(5);
});
it('supports empty libraries and highly compressed silent audio',async()=>{
  await store.exportBackup(archive);const restored=new SongLibraryStore(join(temp,'restored'));
  expect(await restored.restoreBackup(archive)).toEqual({songs:0,playlists:0});
  const s={...song(),audio:[{name:'source',sampleRate:44100,frames:1024*1024,channels:1}]};
  const token=await store.begin(s),bytes=new Uint8Array(4*1024*1024);await store.write(token,'source-0.f32',bytes);await store.commit(token);
  await store.exportBackup(archive);await restored.restoreBackup(archive);
  expect((await restored.audio((await restored.index()).songs[0].id,'source-0.f32')).byteLength).toBe(bytes.length);
});
it('rolls back moved audio if publishing the restored index fails',async()=>{
  await save(store,song());await store.exportBackup(archive);
  const destination=join(temp,'restored'),restored=new SongLibraryStore(destination),existing=song();
  await save(restored,existing);const before=(await readdir(destination)).sort();
  const publish=vi.spyOn(restored as unknown as {publish(index:unknown):Promise<void>},'publish').mockRejectedValueOnce(new Error('Disk full'));
  await expect(restored.restoreBackup(archive)).rejects.toThrow('Disk full');publish.mockRestore();
  expect((await readdir(destination)).sort()).toEqual(before);
  expect((await restored.index()).songs).toEqual([existing]);
  expect(await restored.audio(existing.id,'source-0.f32')).toEqual(pcm);
});
it.each(['checksum','missing','version','duplicate','truncated'])('rejects %s damage without changing the existing library',async damage=>{
  await save(store,song());await store.exportBackup(archive);const dir=await unpack();
  const index=JSON.parse(await readFile(join(dir,'library.json'),'utf8')),path=`${Object.values(index.revisions)[0]}/source-0.f32`;
  if(damage==='checksum')await writeFile(join(dir,path),new Uint8Array(pcm.length).fill(1));
  if(damage==='version'){const manifest=JSON.parse(await readFile(join(dir,'backup-manifest.json'),'utf8'));manifest.version=2;await writeFile(join(dir,'backup-manifest.json'),JSON.stringify(manifest));}
  await repack(dir,damage==='missing'?path:undefined);
  if(damage==='duplicate')await createTar({cwd:dir,file:archive,gzip:true},['backup-manifest.json','library.json','library.json']);
  if(damage==='truncated'){const bytes=await readFile(archive);await writeFile(archive,bytes.subarray(0,Math.floor(bytes.length/2)));}
  const destination=join(temp,'restored'),restored=new SongLibraryStore(destination),existing=song();await save(restored,existing);
  await expect(restored.restoreBackup(archive)).rejects.toThrow();
  expect((await restored.index()).songs).toEqual([existing]);
  expect(await restored.audio(existing.id,'source-0.f32')).toEqual(pcm);
  expect((await readdir(destination)).filter(p=>p.startsWith('.restore-'))).toEqual([]);
});
it.each(['traversal','symlink'])('rejects %s archive entries before writing outside staging',async kind=>{
  await save(store,song());await store.exportBackup(archive);const dir=await unpack();
  const manifest=await readFile(join(dir,'backup-manifest.json')),index=await readFile(join(dir,'library.json'));
  const parts:Buffer[]=[];
  const entry=(path:string,body:Buffer,type:'File'|'SymbolicLink'='File')=>{const header=new Header({path,size:body.length,mode:0o600,type,linkpath:type==='SymbolicLink'?'../../escape':''});header.encode();parts.push(header.block!,body,Buffer.alloc((512-body.length%512)%512));};
  entry('backup-manifest.json',manifest);entry('library.json',index);entry(kind==='traversal'?'../escape':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/source-0.f32',Buffer.alloc(0),kind==='symlink'?'SymbolicLink':'File');parts.push(Buffer.alloc(1024));
  await writeFile(archive,gzipSync(Buffer.concat(parts)));
  await expect(store.restoreBackup(archive)).rejects.toThrow();
  await expect(readFile(join(temp,'escape'))).rejects.toThrow();
});
it('does not overwrite an existing backup if a source asset is missing, and refuses exports inside managed storage',async()=>{
  const s=song();await save(store,s);await store.exportBackup(archive);const original=await readFile(archive);
  await expect(store.exportBackup(join(root,'backup.tar.gz'))).rejects.toThrow(/outside/);
  const index=JSON.parse(await readFile(join(root,'library.json'),'utf8'));await rm(join(root,index.revisions[s.id],'source-0.f32'));
  await expect(store.exportBackup(archive)).rejects.toThrow();expect(await readFile(archive)).toEqual(original);
});
