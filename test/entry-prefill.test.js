const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync(require("node:path").join(__dirname,"../views/index.ejs"),"utf8");
const start=source.indexOf('entryForm.querySelectorAll("[data-entry-prefill]")');
const script=source.slice(start,source.indexOf('dateInput.addEventListener("input", watchSelectedDate);',start));
function fixture({kind="usual",dirty=false,confirm=true,fetch}={}) {
 const button={dataset:{entryPrefill:kind},addEventListener(type,fn){this.click=fn;}};
 const fields={dayTypeSelect:{value:"office",dispatchEvent(){}},arrivalInput:{value:"09:00"},departureInput:{value:"17:00"},lunchInput:{value:"60"},dateInput:{value:"2026-10-05"},clientIdInput:{value:"1"},originalWorkDateInput:{value:""}};
 let marked=0,requests=0;const notices=[];
 const state={isDirty:dirty,isLoading:false,isSaving:false};
 const context={...fields,state,entryForm:{querySelectorAll:()=>[button]},defaultFormValues:{dayType:"office"},window:{confirm:()=>confirm,hoursSettingsStore:{getSettings:()=>({defaultStartTime:"08:30",defaultEndTime:"16:30",defaultPause:45}),refreshCustomSelects(){}}},Event:class{},readEntryFromForm:()=>Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value])),markUnsavedIfNeeded:()=>marked++,emitToast:notice=>notices.push(notice),fetch:async(...args)=>{requests++;return fetch(...args);}};
 vm.runInNewContext(script,context);
 return {...fields,state,button,notices,get marked(){return marked;},get requests(){return requests;}};
}
test("usual hours prefill updates visible fields and dirty state without saving",async()=>{
 const app=fixture();await app.button.click();
 assert.equal(app.arrivalInput.value,"08:30");assert.equal(app.lunchInput.value,45);assert.equal(app.marked,1);assert.equal(app.requests,0);
});
test("declining overwrite preserves edited form",async()=>{
 const app=fixture({dirty:true,confirm:false});await app.button.click();assert.equal(app.arrivalInput.value,"09:00");assert.equal(app.marked,0);
});
test("late previous-day response cannot overwrite a changed date or edited form",async()=>{
 for(const field of ["dateInput","arrivalInput"]){
  let release;const pending=new Promise(resolve=>release=resolve);
  const app=fixture({kind:"last",fetch:()=>pending});const click=app.button.click();
  app[field].value=field==="dateInput"?"2026-10-06":"10:00";
  release({ok:true,json:async()=>({entry:{day_type:"office",arrival_time:"08:00",departure_time:"16:00",lunch_break_minutes:30}})});
  await click;assert.equal(app.marked,0);assert.notEqual(app.arrivalInput.value,"08:00");
 }
});
test("failed prefill preserves existing input and reenables action",async()=>{
 const app=fixture({kind:"last",fetch:async()=>({ok:false})});await app.button.click();
 assert.equal(app.arrivalInput.value,"09:00");assert.equal(app.button.disabled,false);assert.equal(app.notices[0].type,"error");
});
