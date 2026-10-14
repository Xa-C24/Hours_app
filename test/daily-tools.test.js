const test=require("node:test");
const assert=require("node:assert/strict");
const {missingDates}=require("../public/daily-tools");
const {normalizeSettings}=require("../settings");
const {buildNotifications}=require("../public/notification-center");
test("missing days respect custom workweek, recorded leave, today and future",()=>{
  const input={start:"2026-10-01",end:"2026-10-14",today:"2026-10-06",workingDays:[1,2,4,6],entries:[{work_date:"2026-10-01",day_type:"leave"}]};
  assert.deepEqual(missingDates(input),["2026-10-03","2026-10-05"]);
  assert.deepEqual(missingDates({...input,workingDays:[]}),[]);
});
test("working days normalize to unique weekday numbers",()=>{
 assert.deepEqual(normalizeSettings({workingDays:[6,1,6,-1,"2",8]}).workingDays,[1,6]);
 assert.deepEqual(normalizeSettings({workingDays:[]}).workingDays,[]);
});
test("missing-entry alert includes worked Saturdays and excludes nonworking weekdays",()=>{
 const common={entries:[],todayIso:"2026-10-05",payPeriodStartDate:"2026-10-01",payPeriodEndDate:"2026-10-14"};
 const notices=buildNotifications({...common,settings:{workingDays:[6],notifications:{missingEntry:true}}});
 assert.equal(notices[0].date,"2026-10-03");
 assert.equal(buildNotifications({...common,settings:{workingDays:[],notifications:{missingEntry:true}}}).length,0);
});
