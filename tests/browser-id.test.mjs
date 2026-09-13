import assert from "node:assert/strict";
import test from "node:test";
import {browserRandomId} from "../lib/browser-id.ts";

test("plain HTTP fallback creates a valid v4 identifier",()=>{
  let next=0;
  const cryptoApi={
    getRandomValues(bytes){
      for(let index=0;index<bytes.length;index++)bytes[index]=next++;
      return bytes;
    },
  };
  assert.equal(browserRandomId(cryptoApi),"00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("native randomUUID remains preferred on secure origins",()=>{
  const expected="10000000-0000-4000-8000-000000000000";
  assert.equal(browserRandomId({randomUUID:()=>expected,getRandomValues(){throw new Error("unused");}}),expected);
});
