(() => {
  const $=id=>document.getElementById(id);
  let questions=[],room="",players=[],client=null,channel=null,questionIndex=-1,demo=true;
  const letters=["A","B","C","D"];
  const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast=msg=>{const el=$("teacherToast");el.textContent=msg;el.classList.remove("hidden");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.add("hidden"),3000);};
  function load(){try{questions=JSON.parse(localStorage.getItem("rql_questions")||"null")||window.DEFAULT_QUESTIONS.map(q=>({...q}));}catch{questions=window.DEFAULT_QUESTIONS.map(q=>({...q}));}renderEditors();}
  function renderEditors(){
    $("teacherQuestionCount").textContent=questions.length;
    $("questionEditorList").innerHTML=questions.map((q,i)=>`<div class="editor-card" data-q="${i}"><div class="editor-head"><strong>Question ${i+1}</strong><button type="button" class="btn btn-small btn-danger delete-q" data-index="${i}">Delete</button></div><div class="editor-grid"><div class="full-span"><label>Reading passage (optional)</label><textarea data-field="passage" placeholder="Paste a short reading passage…">${safe(q.passage||"")}</textarea></div><div class="full-span"><label>Question</label><textarea data-field="question" required>${safe(q.question||"")}</textarea></div>${[0,1,2,3].map(j=>`<div><label>Option ${letters[j]}</label><input data-field="option${j}" value="${safe(q.options?.[j]||"")}" required></div>`).join("")}<div><label>Correct answer</label><select data-field="answer">${letters.map((l,j)=>`<option value="${j}" ${Number(q.answer)===j?"selected":""}>${l}</option>`).join("")}</select></div><div><label>Points</label><input data-field="points" type="number" min="1" max="1000" value="${Number(q.points)||100}"></div><div><label>Time limit (seconds)</label><input data-field="seconds" type="number" min="5" max="180" value="${Number(q.seconds)||20}"></div><div class="full-span"><label>Explanation (shown after answer)</label><input data-field="explanation" value="${safe(q.explanation||"")}" placeholder="Explain why the answer is correct"></div></div></div>`).join("");
    document.querySelectorAll(".delete-q").forEach(b=>b.addEventListener("click",()=>{if(questions.length<=1){toast("Keep at least one question.");return;}questions.splice(Number(b.dataset.index),1);renderEditors();}));
  }
  function collectEditors(){
    const next=[];document.querySelectorAll(".editor-card").forEach(card=>{const get=f=>card.querySelector(`[data-field="${f}"]`)?.value??"";next.push({passage:get("passage").trim(),question:get("question").trim(),options:[0,1,2,3].map(i=>get("option"+i).trim()),answer:Number(get("answer")),points:Math.max(1,Number(get("points"))||100),seconds:Math.max(5,Number(get("seconds"))||20),explanation:get("explanation").trim()});});return next;
  }
  function sorted(){return [...players].sort((a,b)=>(b.score||0)-(a.score||0));}
  function renderLeaderboard(){const list=sorted();$("teacherLeaderboard").innerHTML=list.length?list.map((p,i)=>`<div class="leader-row"><span class="leader-rank">${String(i+1).padStart(2,"0")}</span><span class="leader-avatar">${safe((p.nickname||"?").slice(0,1).toUpperCase())}</span><span class="leader-name">${safe(p.nickname)}</span><span class="leader-score">${p.score||0}</span></div>`).join(""):'<div class="empty-state">Waiting for students to join.</div>';$("teacherParticipants").textContent=players.length;}
  function saveDemo(){const rooms=JSON.parse(localStorage.getItem("rql_demo_rooms")||"{}");rooms[room]={questions,players,questionIndex,status:questionIndex<0?"lobby":questionIndex>=questions.length?"finished":"live"};localStorage.setItem("rql_demo_rooms",JSON.stringify(rooms));}
  function enableControls(active){$("startQuiz").disabled=!active;$("nextQuestion").disabled=!active;$("endQuiz").disabled=!active;}
  function broadcast(event,payload){if(channel)channel.send({type:"broadcast",event,payload});}
  function roomUpdate(status){$("sessionBadge").textContent=room;$("teacherStatus").textContent=status;enableControls(true);}
  async function createRoom(){
    questions=collectEditors();if(questions.some(q=>!q.question||q.options.some(o=>!o))){toast("Complete every question and all four answer options.");return;}
    localStorage.setItem("rql_questions",JSON.stringify(questions));
    room=$("teacherRoom").value.trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8)||Math.random().toString(36).slice(2,8).toUpperCase();$("teacherRoom").value=room;
    players=[];questionIndex=-1;demo=true;
    if(window.QUIZ_CONFIG?.SUPABASE_URL&&window.QUIZ_CONFIG?.SUPABASE_ANON_KEY&&window.supabase){
      try{client=window.supabase.createClient(window.QUIZ_CONFIG.SUPABASE_URL,window.QUIZ_CONFIG.SUPABASE_ANON_KEY);const {data,error}=await client.functions.invoke("quiz-api",{body:{action:"create",room_code:room,questions}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||"Create failed");demo=false;players=data.players||[];channel=client.channel("room:"+room);channel.on("broadcast",{event:"hello"},({payload})=>{if(payload?.player_id&&!players.some(p=>p.id===payload.player_id)){players.push({id:payload.player_id,nickname:payload.nickname,score:0,joinedAt:Date.now()});renderLeaderboard();}}).subscribe();$("teacherMode").innerHTML="<i></i> Connected";$("teacherMode").classList.add("connected");}
      catch(e){console.error(e);toast("Could not create Supabase room. Check Edge Function and teacher authorization.");return;}
    }else{
      const rooms=JSON.parse(localStorage.getItem("rql_demo_rooms")||"{}");rooms[room]={questions,players,questionIndex,status:"lobby"};localStorage.setItem("rql_demo_rooms",JSON.stringify(rooms));$("teacherMode").innerHTML="<i></i> Demo mode";
    }
    roomUpdate("Lobby");renderLeaderboard();toast(`Room ${room} created. Share the code with students.`);
  }
  async function start(){
    if(!room)return;
    questionIndex=0;
    if(demo){saveDemo();broadcast("state",{status:"live",question_index:questionIndex,questions,players});}
    else{const {data,error}=await client.functions.invoke("quiz-api",{body:{action:"start",room_code:room}});if(error||!data?.ok){toast("Unable to start quiz.");return;}questionIndex=data.question_index??0;broadcast("state",data);}
    $("teacherStatus").textContent=`Question ${questionIndex+1}`;toast("Quiz started!");
  }
  async function next(){
    if(!room)return;
    questionIndex++;
    if(questionIndex>=questions.length){await end();return;}
    if(demo){saveDemo();broadcast("state",{status:"live",question_index:questionIndex,questions,players});}
    else{const {data,error}=await client.functions.invoke("quiz-api",{body:{action:"next",room_code:room}});if(error||!data?.ok){toast("Could not advance question.");return;}questionIndex=data.question_index;broadcast("state",data);}
    $("teacherStatus").textContent=`Question ${questionIndex+1}`;
  }
  async function end(){
    if(!room)return;
    questionIndex=questions.length;
    if(demo){saveDemo();broadcast("state",{status:"finished",question_index:questionIndex,players});}
    else{const {data,error}=await client.functions.invoke("quiz-api",{body:{action:"end",room_code:room}});if(error||!data?.ok){toast("Could not end quiz.");return;}broadcast("state",data);}
    $("teacherStatus").textContent="Finished";enableControls(false);toast("Quiz ended. Final scores are ready.");
  }
  function exportCsv(){
    const rows=[["Rank","Nickname","Score"],...sorted().map((p,i)=>[i+1,p.nickname,p.score||0])];
    if(rows.length===1){toast("There are no participant results to export yet.");return;}
    const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download=`reading-quiz-${room||"results"}.csv`;a.click();URL.revokeObjectURL(url);
  }
  $("createRoom").addEventListener("click",createRoom);
  $("startQuiz").addEventListener("click",start);
  $("nextQuestion").addEventListener("click",next);
  $("endQuiz").addEventListener("click",end);
  $("addQuestion").addEventListener("click",()=>{questions=collectEditors();questions.push({passage:"",question:"",options:["","","",""],answer:0,points:100,seconds:20,explanation:""});renderEditors();});
  $("saveQuestions").addEventListener("click",()=>{questions=collectEditors();if(questions.some(q=>!q.question||q.options.some(o=>!o))){toast("Please complete each question and all four options.");return;}localStorage.setItem("rql_questions",JSON.stringify(questions));$("teacherQuestionCount").textContent=questions.length;toast("Question bank saved in this browser.");});
  $("exportCsv").addEventListener("click",exportCsv);
  load();enableControls(false);
})();