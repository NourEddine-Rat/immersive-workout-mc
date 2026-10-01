// Transport/game tests begin with a completed profile. Onboarding has separate UI coverage.
export async function returningPhone(page){
  await page.addInitScript(()=>{
    if(!localStorage.getItem('inmotion.basics.v1'))localStorage.setItem('inmotion.basics.v1',JSON.stringify({v:1,username:'test_player',sex:'female',weightKg:70}));
  });
}
