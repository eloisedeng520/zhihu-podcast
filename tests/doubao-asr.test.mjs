import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speechRecognitionReady,transcribeQuestion} from '../server/doubao-asr.ts';

const env={ASR_PROVIDER:'doubao',DOUBAO_ASR_API_KEY:'asr-test-key',DOUBAO_ASR_RESOURCE_ID:'volc.bigasr.auc_turbo'};
const wav=Uint8Array.from([82,73,70,70,4,0,0,0,87,65,86,69]);

test('Doubao ASR readiness requires a supported provider and a non-empty key',()=>{
  assert.equal(speechRecognitionReady(env),true);
  assert.equal(speechRecognitionReady({...env,ASR_PROVIDER:undefined}),true);
  assert.equal(speechRecognitionReady({...env,ASR_PROVIDER:'unsupported'}),false);
  assert.equal(speechRecognitionReady({...env,DOUBAO_ASR_API_KEY:'  '}),false);
});
test('Doubao ASR can reuse the shared speech API key',()=>assert.equal(speechRecognitionReady({DOUBAO_API_KEY:'shared-key'}),true));

test('Doubao ASR sends WAV bytes only in the request body and returns trimmed text',async t=>{
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash');
    assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');
    const headers=new Headers(init.headers),body=JSON.parse(init.body);
    assert.equal(headers.get('X-Api-Key'),'asr-test-key');
    assert.equal(headers.get('X-Api-Resource-Id'),'volc.bigasr.auc_turbo');
    assert.ok(headers.get('X-Api-Request-Id'));
    assert.equal(body.audio.format,'wav');
    assert.equal(body.audio.data,Buffer.from(wav).toString('base64'));
    assert.equal(body.request.model_name,'bigmodel');
    return Response.json({result:{text:'  为什么要先了解岗位职责？  '}});
  });
  assert.equal(await transcribeQuestion(env,wav),'为什么要先了解岗位职责？');
});

test('Doubao ASR accepts list-shaped transcription results',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({result:[{text:'这条建议有什么边界？'}]}));
  assert.equal(await transcribeQuestion(env,wav),'这条建议有什么边界？');
});

test('Doubao ASR rejects empty and excessively long transcriptions',async t=>{
  for(const data of [{result:{text:'  '}},{result:{text:'问'.repeat(301)}},{unexpected:true}]){
    t.mock.method(globalThis,'fetch',async()=>Response.json(data));
    await assert.rejects(()=>transcribeQuestion(env,wav),/重新录制|过长/);
  }
});

test('Doubao ASR refuses missing configuration before sending secrets and hides upstream bodies',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('private upstream detail',{status:403});});
  await assert.rejects(()=>transcribeQuestion({...env,DOUBAO_ASR_API_KEY:''},wav),/尚未配置/);
  assert.equal(calls,0);
  await assert.rejects(()=>transcribeQuestion(env,wav),error=>error.message.includes('鉴权失败')&&!error.message.includes('private upstream detail'));
  assert.equal(calls,1);
});
