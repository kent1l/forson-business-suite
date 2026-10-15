const {share,preview}=require('../services/hr/loanSchedule');
test.each([
 ['FIRST_CUTOFF','100.01','100.01','0.00'],['SECOND_CUTOFF','100.01','0.00','100.01'],
 ['SPLIT_HALF','100.01','50.01','50.00'],['SPLIT_HALF','0.01','0.01','0.00'],['SPLIT_HALF','9999999999.99','5000000000.00','4999999999.99'],
])('%s preserves the exact monthly total', (schedule,monthly,first,second)=>expect(preview(monthly,schedule)).toEqual({first_cutoff:first,second_cutoff:second}));
test('rejects unknown schedule, cutoff and fractional centavo',()=>{
 expect(()=>share('100.00','EVERY_CUTOFF',1)).toThrow();expect(()=>share('100.00','SPLIT_HALF',3)).toThrow();expect(()=>share('0.001','SPLIT_HALF',1)).toThrow();
});
