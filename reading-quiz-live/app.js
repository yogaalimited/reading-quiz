(() => {
  const $ = (id) => document.getElementById(id);
  const views = ["joinView","lobbyView","quizView","resultsView"];
  let client = null, channel = null, room = "", nickname = "", playerId = "", questions = [], players = [];
  let questionIndex = -1, score = 0, answered = false, timerHandle = null, endAt = 0, demo = true, pollHandle = null;
  const letters = ["A","B","C","D"];
  const showView = (id) => views.forEach(v => $(v).classList.toggle("hidden", v !== id));
  const toast = (message) => { const el=$("toast"); el.textContent=message; el.classList.remove("hidden"); clearTimeout(el._timer); el._timer=setTimeout(()=>el.classList.add("hidden"),3000); };
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const loadQuestions = () => { try { return JSON.parse(localStorage.getItem("rql_questions") || "null") || window.DEFAULT_QUESTIONS; } catch { return window.DEFAULT_QUESTIONS; } };
  function setConnection(text, connected=false) { $("connection").innerHTML=`<i></i> ${safe(text)}`; $("connection").classList.toggle("connected",connected); }
  function sortedPlayers() { return [...players].sort((a,b)=>(b.score||0)-(a.score||0) || (a.joinedAt||0)-(b.joinedAt||0)); }
  function renderParticipants() {
    $("participantCount").textContent = `${players.length} joined`;
    $("participantList").innerHTML = players.length ? players.map(p=>`<div class="participant-item"><div class="avatar">${safe((p.nickname||"?").slice(0,1).toUpperCase())}</div><span class="participant-name">${safe(p.nickname)}</span>${p.id===playerId?'<span class="you-tag">YOU</span>':''}</div>`).join("") : '<div class="empty-state">Waiting for participants…</div>';
  }
  function renderLeaderboard(target="leaderboard") {
    const sorted=sortedPlayers().slice(0,10);
    $(target).innerHTML=sorted.length ? sorted.map((p,i)=>`<div class="leader-row"><span class="leader-rank">${String(i+1).padStart(2,"0")}</span><span class="leader-avatar">${safe((p.nickname||"?").slice(0,1).toUpperCase())}</span><span class="leader-name">${safe(p.nickname)}${p.id===playerId?' (you)':''}</span><span class="leader-score">${p.score||0}</span></div>`).join("") : '<div class="empty-state">Scores will appear here.</div>';
  }
  function updateOwnScore(){ const me=players.find(p=>p.id===playerId); score=me?.score||score; $("scoreValue").textContent=score; renderLeaderboard(); }
  function broadcast(type,payload={}) { if(channel) channel.send({type:"broadcast",event:type,payload}); }
  function addOrUpdatePlayer(p){ const idx=players.findIndex(x=>x.id===p.id); if(idx<0) players.push(p); else players[idx]={...players[idx],...p}; renderParticipants(); renderLeaderboard(); }
  function openDemoRoom() {
    const rooms=JSON.parse(localStorage.getItem("rql_demo_rooms")||"{}");
    if(!rooms[room]) return false;
    const saved=rooms[room]; questions=saved.questions||loadQuestions();
    players=saved.players||[]; questionIndex=saved.questionIndex??-1;
    return true;
  }
  function saveDemoRoom(){
    const rooms=JSON.parse(localStorage.getItem("rql_demo_rooms")||"{}");
    rooms[room]={questions,players,questionIndex,status:questionIndex<0?"lobby":questionIndex>=questions.length?"finished":"live"};
    localStorage.setItem("rql_demo_rooms",JSON.stringify(rooms));
  }
  async function joinRoom(event) {
    event.preventDefault();
    nickname=$("nickname").value.trim().slice(0,24); room=$("roomCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
    if(!nickname || room.length<4) return toast("Enter a nickname and a room code of at least 4 characters.");
    playerId=sessionStorage.getItem("rql_player_id")||("p_"+Math.random().toString(36).slice(2,11)); sessionStorage.setItem("rql_player_id",playerId);
    questions=loadQuestions(); score=0;
    if(window.QUIZ_CONFIG?.SUPABASE_URL && window.QUIZ_CONFIG?.SUPABASE_ANON_KEY && window.supabase) {
      try { client=window.supabase.createClient(window.QUIZ_CONFIG.SUPABASE_URL,window.QUIZ_CONFIG.SUPABASE_ANON_KEY); const {data,error}=await client.functions.invoke("quiz-api",{body:{action:"join",room_code:room,nickname,player_id:playerId}}); if(error) throw error; if(!data?.ok) throw new Error(data?.error||"Unable to join room"); demo=false; setConnection("Connected",true); players=data.players||[]; questions=data.questions||questions; channel=client.channel("room:"+room); channel.on("broadcast",{event:"state"},({payload})=>handleState(payload)).subscribe((status)=>{if(status==="SUBSCRIBED") channel.send({type:"broadcast",event:"hello",payload:{player_id:playerId,nickname}})}); }
      catch(err){ console.error(err); toast("Could not connect to live server. Check Supabase setup and room code."); return; }
    } else {
      demo=true; if(!openDemoRoom()){toast("Room not found in demo mode. Create it from Teacher dashboard in this same browser.");return;}
      const existing=players.find(p=>p.id===playerId); if(!existing) players.push({id:playerId,nickname,score:0,joinedAt:Date.now()}); else existing.nickname=nickname;
      saveDemoRoom(); setConnection("Demo mode",false);
    }
    $("lobbyCode").textContent=room; $("quizRoomCode").textContent=room; renderParticipants(); showView("lobbyView");
    if(!demo){channel.on("broadcast",{event:"start"},({payload})=>handleState(payload)); channel.on("broadcast",{event:"question"},({payload})=>handleState(payload)); channel.on("broadcast",{event:"score"},({payload})=>handleState(payload)); channel.on("broadcast",{event:"end"},({payload})=>handleState(payload));}
    if(!demo) syncState();
    clearInterval(pollHandle); if(!demo) pollHandle=setInterval(syncState,6000);
    if(questionIndex>=0) showCurrentQuestion();
  }
  async function syncState(){
    if(!client||demo)return;
    try{const {data,error}=await client.functions.invoke("quiz-api",{body:{action:"state",room_code:room,player_id:playerId}});if(!error&&data?.ok)handleState(data);}catch(e){console.warn("State sync",e);}
  }
  function handleState(data){
    if(!data)return;
    if(data.players){players=data.players.map(p=>({...p,score:p.score||0}));renderParticipants();renderLeaderboard();updateOwnScore();}
    if(data.questions)questions=data.questions;
    if(typeof data.question_index==="number" && data.question_index!==questionIndex){questionIndex=data.question_index;answered=false;if(questionIndex>=questions.length){finishQuiz();return;}if(questionIndex>=0)showCurrentQuestion();}
    if(data.status==="finished"||data.event==="end"){finishQuiz();}
    if(data.deadline) {endAt=new Date(data.deadline).getTime(); startTimer();}
    if(data.question_index===-1 && data.status==="lobby")showView("lobbyView");
  }
  function showCurrentQuestion(){
    if(questionIndex<0){showView("lobbyView");return;}
    if(questionIndex>=questions.length){finishQuiz();return;}
    const q=questions[questionIndex]; if(!q)return;
    answered=false; showView("quizView"); $("questionNumber").textContent=`QUESTION ${questionIndex+1} / ${questions.length}`; $("questionPoints").textContent=`+${q.points||100} pts`;
    $("progressBar").style.width=`${((questionIndex+1)/questions.length)*100}%`;
    $("questionText").textContent=q.question;
    $("passageBox").classList.toggle("hidden",!q.passage); $("passageText").textContent=q.passage||"";
    $("answerFeedback").className="answer-feedback hidden"; $("answerFeedback").textContent="";
    $("answers").innerHTML=q.options.map((opt,i)=>`<button class="answer-option" data-index="${i}"><span class="answer-letter">${letters[i]}</span><span>${safe(opt)}</span></button>`).join("");
    [...$("answers").querySelectorAll("button")].forEach(btn=>btn.addEventListener("click",()=>submitAnswer(Number(btn.dataset.index))));
    if(demo){endAt=Date.now()+(q.seconds||20)*1000;saveDemoRoom();}
    startTimer(); updateOwnScore();
  }
  function startTimer(){
    clearInterval(timerHandle);
    const tick=()=>{const remaining=Math.max(0,Math.ceil((endAt-Date.now())/1000));$("timer").textContent=remaining;if(remaining<=5)$("timer").style.color="#d94a5c";else $("timer").style.color="";if(remaining<=0){clearInterval(timerHandle);[...$("answers").querySelectorAll("button")].forEach(b=>b.disabled=true);if(!answered)showFeedback(false,"Time is up!");}};
    tick();timerHandle=setInterval(tick,250);
  }
  async function submitAnswer(index){
    if(answered||questionIndex<0)return;
    answered=true; const q=questions[questionIndex]; const correct=index===q.answer;
    [...$("answers").querySelectorAll("button")].forEach((b,i)=>{b.disabled=true;if(i===index)b.classList.add("selected");});
    if(demo){
      const me=players.find(p=>p.id===playerId); if(me){if(correct){const remain=Math.max(0,Math.ceil((endAt-Date.now())/1000));me.score=(me.score||0)+(q.points||100)+Math.floor(remain*2);}me.answered=me.answered||[];me.answered[questionIndex]=index;}
      saveDemoRoom();renderLeaderboard();updateOwnScore();showFeedback(correct,correct?`Correct! ${q.explanation||""}`:`Not quite. ${q.explanation||"Keep going!"}`);
    } else {
      try{const {data,error}=await client.functions.invoke("quiz-api",{body:{action:"answer",room_code:room,player_id:playerId,question_index:questionIndex,answer_index:index}});if(error||!data?.ok)throw error||new Error(data?.error||"Answer not saved");if(data.players){players=data.players;updateOwnScore();}showFeedback(!!data.correct,data.correct?`Correct! ${data.explanation||""}`:`Not quite. ${data.explanation||"Keep going!"}`);}
      catch(e){answered=false;toast("Your answer could not be saved. Please try again.");console.error(e);}
    }
  }
  function showFeedback(good,msg){const el=$("answerFeedback");el.textContent=msg;el.className=`answer-feedback ${good?"good":"bad"}`;}
  function finishQuiz(){
    clearInterval(timerHandle);clearInterval(pollHandle);showView("resultsView");$("finalScore").textContent=(players.find(p=>p.id===playerId)?.score??score);const rank=sortedPlayers().findIndex(p=>p.id===playerId)+1;$("finalRank").textContent=rank?`You finished ${rank===1?"1st":rank===2?"2nd":rank===3?"3rd":rank+"th"} out of ${players.length} participants.`:"Thanks for playing!";$("resultCount").textContent=`${players.length} players`;renderLeaderboard("finalLeaderboard");
  }
  // Demo-mode coordination across tabs in the same browser. Real multi-device play requires Supabase.
  window.addEventListener("storage", (event) => {
    if (demo && event.key === "rql_demo_rooms" && room) {
      try {
        const rooms = JSON.parse(event.newValue || "{}");
        const saved = rooms[room];
        if (!saved) return;
        players = saved.players || players;
        questions = saved.questions || questions;
        const nextIndex = typeof saved.questionIndex === "number" ? saved.questionIndex : -1;
        if (saved.status === "finished" || nextIndex >= questions.length) {
          questionIndex = nextIndex;
          finishQuiz();
        } else if (nextIndex >= 0 && nextIndex !== questionIndex) {
          questionIndex = nextIndex;
          showCurrentQuestion();
        } else {
          renderParticipants();
          renderLeaderboard();
          updateOwnScore();
        }
      } catch (e) { console.warn("Could not sync demo room", e); }
    }
  });

  $("joinForm").addEventListener("submit",joinRoom);
  $("leaveLobby").addEventListener("click",()=>{clearInterval(pollHandle);if(channel)client.removeChannel(channel);channel=null;showView("joinView");});
  $("copyCode").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(room);toast("Room code copied!");}catch{toast("Room code: "+room);}});
  $("playAgain").addEventListener("click",()=>{if(channel&&client)client.removeChannel(channel);channel=null;clearInterval(pollHandle);showView("joinView");});
})();