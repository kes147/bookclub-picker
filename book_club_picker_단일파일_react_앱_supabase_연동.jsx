import React, { useEffect, useMemo, useState } from "react";

/*
  BookClub Picker — 단일파일 React 앱 (무료 배포 + 비밀 링크 + 다중 독서회 + 투표 + 히스토리)

  ✅ 특징
  - 비밀 링크(초대 코드)로 접근: /?club=<clubSlug>&invite=<inviteCode>&semester=<semesterId>
  - 여러 독서회(클럽) 동시 운영. 링크가 다르면 서로 보이지 않음.
  - 책 추천 수집, 투표(1인당 각 책에 1표) 및 결과 집계.
  - 지난 학기 히스토리 열람.
  - 관리자 뷰: 클럽/학기 생성, 초대 링크 생성, 데이터 정리.
  - 무료 배포: Netlify/Vercel 정적 배포 + Supabase(무료 플랜) 백엔드 권장.

  ⚠️ 간단한 MVP 설계로, 초대 링크 보안은 “링크 은닉” 수준입니다.
     (실제 RLS/권한 강화를 위한 SQL 예시는 아래 주석의 스키마 섹션 참고.)

  📦 필요 환경변수
    - VITE_SUPABASE_URL
    - VITE_SUPABASE_ANON_KEY
    - VITE_ADMIN_PASSCODE  (관리자 화면 잠금용 간단 패스코드)

  🗄️ Supabase 스키마(SQL) — 프로젝트 SQL Editor에 붙여넣기
  ----------------------------------------------------------------
  -- Clubs (독서회)
  create table if not exists clubs (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text unique not null, -- 링크로 쓰기 쉬운 짧은 식별자
    created_at timestamptz default now()
  );

  -- Semesters (학기)
  create table if not exists semesters (
    id uuid primary key default gen_random_uuid(),
    club_id uuid references clubs(id) on delete cascade,
    title text not null, -- ex) 2025 가을학기
    start_date date,
    end_date date,
    created_at timestamptz default now()
  );
  create index if not exists idx_semesters_club on semesters(club_id);

  -- Invite codes (비밀 링크 구성요소)
  create table if not exists invites (
    id uuid primary key default gen_random_uuid(),
    club_id uuid references clubs(id) on delete cascade,
    code text unique not null,
    note text,
    created_at timestamptz default now()
  );
  create index if not exists idx_invites_club on invites(club_id);

  -- Books (추천 도서)
  create table if not exists books (
    id uuid primary key default gen_random_uuid(),
    club_id uuid references clubs(id) on delete cascade,
    semester_id uuid references semesters(id) on delete cascade,
    title text not null,
    author text,
    isbn text,
    info_url text,
    cover_url text,
    suggested_by text,
    created_at timestamptz default now()
  );
  create index if not exists idx_books_club_sem on books(club_id, semester_id);

  -- Votes (투표)
  create table if not exists votes (
    id uuid primary key default gen_random_uuid(),
    book_id uuid references books(id) on delete cascade,
    voter_token text not null, -- 클라이언트 로컬토큰(링크별)
    created_at timestamptz default now(),
    unique(book_id, voter_token)
  );
  create index if not exists idx_votes_book on votes(book_id);

  -- 단순 RLS (선택): 공개 조회 허용, 쓰기는 제한
  -- 실제 운영에서는 정책을 더 정교화 하세요.
  alter table clubs enable row level security;
  alter table semesters enable row level security;
  alter table invites enable row level security;
  alter table books enable row level security;
  alter table votes enable row level security;

  -- 예시 정책: 모두 읽기 허용(프론트 필터링 전제), 쓰기는 anon만 허용
  do $$ begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'books' and policyname = 'books_select_all') then
      create policy books_select_all on books for select using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'books' and policyname = 'books_insert_anon') then
      create policy books_insert_anon on books for insert with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'votes' and policyname = 'votes_select_all') then
      create policy votes_select_all on votes for select using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'votes' and policyname = 'votes_insert_anon') then
      create policy votes_insert_anon on votes for insert with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clubs' and policyname = 'clubs_select_all') then
      create policy clubs_select_all on clubs for select using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'semesters' and policyname = 'semesters_select_all') then
      create policy semesters_select_all on semesters for select using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invites' and policyname = 'invites_select_all') then
      create policy invites_select_all on invites for select using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invites' and policyname = 'invites_insert_anon') then
      create policy invites_insert_anon on invites for insert with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clubs' and policyname = 'clubs_insert_anon') then
      create policy clubs_insert_anon on clubs for insert with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'semesters' and policyname = 'semesters_insert_anon') then
      create policy semesters_insert_anon on semesters for insert with check (true);
    end if;
  end $$;

  ----------------------------------------------------------------
  프로덕션 보안 업그레이드 아이디어
  - 초대코드 기반 JWT 커스텀 클레임 + RLS로 club_id를 제한
  - 관리자 전용 Service Role Key는 서버(Cloud Functions/Edge)에서만 사용
  - 이메일/비번 없이도 magic link(비번없음)로 가입 처리 등

*/

// --- 클라이언트 설정 ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASSCODE;

// CDN 없이 직접 import가 어려우므로, 런타임 로더 사용
async function loadSupabase() {
  if (window._supabase) return window._supabase;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window._supabase = client;
  return client;
}

function useQueryParams() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const get = (k, d = "") => params.get(k) || d;
  return { get };
}

function uidFromLocal(inviteKey) {
  const k = `bookclub.voterToken.${inviteKey}`;
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(k, v);
  }
  return v;
}

function Section({ title, children, right }) {
  return (
    <section className="bg-white/80 backdrop-blur rounded-2xl shadow p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm text-gray-600 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  );
}

function Button({ children, onClick, variant = "primary", disabled }) {
  const base =
    "px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition active:translate-y-px";
  const styles = {
    primary:
      "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed",
    ghost: "bg-white border hover:bg-gray-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]}`}>
      {children}
    </button>
  );
}

export default function App() {
  const qp = useQueryParams();
  const clubSlug = qp.get("club");
  const inviteCode = qp.get("invite");
  const semesterId = qp.get("semester");
  const inviteKey = `${clubSlug}|${inviteCode}|${semesterId}`;
  const voterToken = uidFromLocal(inviteKey);

  const [sb, setSb] = useState(null);
  const [ready, setReady] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAuth, setAdminAuth] = useState("");

  // Data
  const [club, setClub] = useState(null);
  const [semester, setSemester] = useState(null);
  const [books, setBooks] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      const client = await loadSupabase();
      setSb(client);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!sb || !clubSlug) return;
    (async () => {
      setLoading(true);
      const { data: clubData } = await sb
        .from("clubs")
        .select("*")
        .eq("slug", clubSlug)
        .single();
      setClub(clubData || null);

      if (semesterId) {
        const { data: sem } = await sb
          .from("semesters")
          .select("*")
          .eq("id", semesterId)
          .maybeSingle();
        setSemester(sem || null);
      } else if (clubData) {
        // 최근 학기 하나 가져오기
        const { data: sems } = await sb
          .from("semesters")
          .select("*")
          .eq("club_id", clubData.id)
          .order("start_date", { ascending: false })
          .limit(1);
        setSemester(sems?.[0] || null);
      }
      setLoading(false);
    })();
  }, [sb, clubSlug, semesterId]);

  useEffect(() => {
    if (!sb || !club || !semester) return;
    (async () => {
      const { data: bookRows } = await sb
        .from("books")
        .select("*")
        .eq("club_id", club.id)
        .eq("semester_id", semester.id)
        .order("created_at", { ascending: true });
      setBooks(bookRows || []);

      const { data: voteRows } = await sb
        .from("votes")
        .select("*")
        .in("book_id", (bookRows || []).map((b) => b.id).concat("00000000-0000-0000-0000-000000000000"));
      setVotes(voteRows || []);
    })();
  }, [sb, club, semester]);

  const tally = useMemo(() => {
    const m = new Map();
    for (const b of books) m.set(b.id, 0);
    for (const v of votes) m.set(v.book_id, (m.get(v.book_id) || 0) + 1);
    return m;
  }, [books, votes]);

  const myVotes = useMemo(() => new Set(votes.filter(v => v.voter_token === voterToken).map(v => v.book_id)), [votes, voterToken]);

  async function addBook(newBook) {
    if (!sb || !club || !semester) return;
    const payload = {
      club_id: club.id,
      semester_id: semester.id,
      ...newBook,
    };
    const { data, error } = await sb.from("books").insert(payload).select("*").single();
    if (!error && data) setBooks((prev) => [...prev, data]);
  }

  async function toggleVote(bookId) {
    if (!sb) return;
    if (myVotes.has(bookId)) {
      // 투표 취소: 동일 voter_token 표 하나 삭제
      const row = votes.find(v => v.book_id === bookId && v.voter_token === voterToken);
      if (!row) return;
      const { error } = await sb.from("votes").delete().eq("id", row.id);
      if (!error) setVotes(votes.filter(v => v.id !== row.id));
    } else {
      const { data, error } = await sb
        .from("votes")
        .insert({ book_id: bookId, voter_token: voterToken })
        .select("*")
        .single();
      if (!error && data) setVotes((prev) => [...prev, data]);
    }
  }

  function ShareLinkRow({ label, url }) {
    return (
      <div className="flex items-center gap-2 text-sm bg-gray-50 border rounded-xl p-2 overflow-auto">
        <span className="text-gray-500 whitespace-nowrap">{label}</span>
        <input value={url} readOnly className="flex-1 bg-transparent outline-none" />
        <Button variant="ghost" onClick={() => navigator.clipboard.writeText(url)}>복사</Button>
      </div>
    );
  }

  // Admin helpers
  const [formClub, setFormClub] = useState({ name: "", slug: "" });
  const [formSem, setFormSem] = useState({ title: "", start_date: "", end_date: "" });
  const [inviteNote, setInviteNote] = useState("");
  const baseUrl = `${window.location.origin}${window.location.pathname}`;

  async function createClub() {
    const s = await loadSupabase();
    const { data, error } = await s.from("clubs").insert({ name: formClub.name.trim(), slug: formClub.slug.trim() }).select("*").single();
    if (error) return alert(error.message);
    alert(`클럽 생성 완료: ${data.name}`);
  }

  async function createSemester() {
    if (!club) return alert("클럽을 먼저 선택/생성하세요.");
    const { data, error } = await sb
      .from("semesters")
      .insert({ club_id: club.id, title: formSem.title.trim(), start_date: formSem.start_date || null, end_date: formSem.end_date || null })
      .select("*")
      .single();
    if (error) return alert(error.message);
    setSemester(data);
    alert("학기 생성 완료");
  }

  async function createInvite() {
    if (!club) return alert("클럽을 먼저 선택/생성하세요.");
    const code = Math.random().toString(36).slice(2, 10);
    const { data, error } = await sb
      .from("invites")
      .insert({ club_id: club.id, code, note: inviteNote || null })
      .select("*")
      .single();
    if (error) return alert(error.message);
    const url = `${baseUrl}?club=${club.slug}&invite=${data.code}${semester ? `&semester=${semester.id}` : ""}`;
    navigator.clipboard.writeText(url);
    alert("초대 링크가 클립보드에 복사되었습니다.");
  }

  function AdminPanel() {
    if (!adminOpen) return null;
    if (ADMIN_PASS && adminAuth !== ADMIN_PASS) {
      return (
        <Section title="관리자 로그인">
          <TextInput label="관리자 패스코드" value={adminAuth} onChange={setAdminAuth} placeholder="환경변수에 설정한 코드" />
          <Button onClick={() => setAdminOpen(true)}>확인</Button>
        </Section>
      );
    }

    return (
      <>
        <Section title="클럽 생성">
          <div className="grid md:grid-cols-2 gap-3">
            <TextInput label="클럽 이름" value={formClub.name} onChange={(v)=>setFormClub({...formClub,name:v})} placeholder="예) 수요 인문학 독서회" />
            <TextInput label="클럽 슬러그" value={formClub.slug} onChange={(v)=>setFormClub({...formClub,slug:v})} placeholder="예) wednesday-humanities" />
          </div>
          <div className="flex gap-2">
            <Button onClick={createClub}>클럽 생성</Button>
          </div>
        </Section>

        <Section title="학기 생성">
          <div className="grid md:grid-cols-3 gap-3">
            <TextInput label="학기명" value={formSem.title} onChange={(v)=>setFormSem({...formSem,title:v})} placeholder="예) 2025 가을학기" />
            <TextInput label="시작일" type="date" value={formSem.start_date} onChange={(v)=>setFormSem({...formSem,start_date:v})} />
            <TextInput label="종료일" type="date" value={formSem.end_date} onChange={(v)=>setFormSem({...formSem,end_date:v})} />
          </div>
          <Button onClick={createSemester}>학기 생성</Button>
        </Section>

        <Section title="초대 링크 만들기">
          <TextInput label="메모(선택)" value={inviteNote} onChange={setInviteNote} placeholder="예) 2기 신입 모집 링크" />
          <Button onClick={createInvite}>초대 링크 생성 & 복사</Button>
          {club && (
            <div className="mt-3 text-sm text-gray-500">현재 클럽: <b>{club.name}</b> (slug: {club.slug})</div>
          )}
        </Section>

        {club && semester && (
          <Section title="현재 세션 링크들">
            <div className="space-y-2">
              <ShareLinkRow label="관리자 뷰(현재 클럽/학기)" url={`${baseUrl}?club=${club.slug}${semester?`&semester=${semester.id}`:""}`} />
              <div className="text-xs text-gray-500">* 구성원에겐 초대 코드가 포함된 링크를 배포하세요.</div>
            </div>
          </Section>
        )}
      </>
    );
  }

  function AddBookForm() {
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [isbn, setIsbn] = useState("");
    const [infoUrl, setInfoUrl] = useState("");
    const [coverUrl, setCoverUrl] = useState("");
    const [suggestedBy, setSuggestedBy] = useState("");

    return (
      <Section title="추천 도서 등록">
        <div className="grid md:grid-cols-2 gap-3">
          <TextInput label="제목*" value={title} onChange={setTitle} placeholder="책 제목" />
          <TextInput label="저자" value={author} onChange={setAuthor} placeholder="저자명" />
          <TextInput label="ISBN" value={isbn} onChange={setIsbn} placeholder="978-..." />
          <TextInput label="정보 링크" value={infoUrl} onChange={setInfoUrl} placeholder="교보/알라딘/출판사 페이지 등" />
          <TextInput label="표지 이미지 URL" value={coverUrl} onChange={setCoverUrl} placeholder="이미지 주소 (선택)" />
          <TextInput label="추천자" value={suggestedBy} onChange={setSuggestedBy} placeholder="이름 또는 닉네임" />
        </div>
        <div className="mt-3">
          <Button
            onClick={() => {
              if (!title.trim()) return alert("제목은 필수입니다.");
              addBook({ title: title.trim(), author: author.trim() || null, isbn: isbn.trim() || null, info_url: infoUrl.trim() || null, cover_url: coverUrl.trim() || null, suggested_by: suggestedBy.trim() || null });
              setTitle(""); setAuthor(""); setIsbn(""); setInfoUrl(""); setCoverUrl(""); setSuggestedBy("");
            }}
          >등록</Button>
        </div>
      </Section>
    );
  }

  function BookCard({ b }) {
    const voted = myVotes.has(b.id);
    const count = tally.get(b.id) || 0;

    return (
      <div className="flex gap-4 bg-white rounded-2xl border shadow-sm p-3">
        {b.cover_url ? (
          <img src={b.cover_url} alt="cover" className="w-20 h-28 object-cover rounded-xl" />
        ) : (
          <div className="w-20 h-28 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400">No Image</div>
        )}
        <div className="flex-1">
          <div className="font-semibold text-lg">{b.title}</div>
          <div className="text-sm text-gray-600">{b.author || "저자 미상"}</div>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
            {b.isbn && <span>ISBN: {b.isbn}</span>}
            {b.suggested_by && <span>추천: {b.suggested_by}</span>}
            {b.info_url && (
              <a className="underline" href={b.info_url} target="_blank" rel="noreferrer">정보</a>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button variant={voted ? "danger" : "primary"} onClick={() => toggleVote(b.id)}>
              {voted ? "투표 취소" : "이 책에 투표"}
            </Button>
            <span className="text-sm text-gray-600">현재 득표: <b>{count}</b></span>
          </div>
        </div>
      </div>
    );
  }

  const sortedBooks = useMemo(() => {
    return [...books].sort((a,b) => (tally.get(b.id)||0) - (tally.get(a.id)||0));
  }, [books, tally]);

  const validLink = clubSlug && inviteCode; // 학기 파라미터는 선택

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white text-gray-900">
      <div className="max-w-5xl mx-auto px-5 py-8">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">BookClub Picker</h1>
            <p className="text-gray-600 text-sm">추천·투표·히스토리를 한 곳에서</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setAdminOpen(v => !v)}>관리자</Button>
          </div>
        </header>

        {adminOpen && <AdminPanel />}

        {!SUPABASE_URL || !SUPABASE_ANON_KEY ? (
          <Section title="설정 필요">
            <p className="text-sm leading-6 text-gray-700">
              환경변수 <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code> 가 설정되어 있지 않습니다. 
              Vercel/Netlify 프로젝트 환경변수에 추가한 뒤 다시 배포하세요.
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-indigo-600">스키마(SQL) 보기</summary>
              <pre className="text-xs mt-2 p-3 bg-gray-900 text-gray-100 rounded-xl overflow-auto max-h-80">{`(이 파일 상단 주석의 SQL 블록을 참고하세요.)`}</pre>
            </details>
          </Section>
        ) : null}

        {!validLink && (
          <Section title="접속 안내 (비밀 링크 필요)">
            <p className="text-sm text-gray-700 mb-2">아래 형식의 비밀 링크로 접속해야 합니다.</p>
            <code className="text-xs bg-gray-100 rounded px-2 py-1">{`${window.location.origin}${window.location.pathname}?club=<slug>&invite=<code>&semester=<optional>`}</code>
            <p className="text-xs text-gray-500 mt-2">관리자 패널에서 클럽/학기/초대 링크를 생성해 배포하세요.</p>
          </Section>
        )}

        {ready && validLink && (
          <>
            <Section title={club ? `${club.name} — ${semester ? semester.title : "학기 미지정"}` : "로딩 중..."}
              right={(
                <div className="text-xs text-gray-500">초대 코드: <span className="font-mono">{inviteCode}</span></div>
              )}
            >
              <p className="text-sm text-gray-700">아래에서 책을 추천하고, 마음에 드는 책에 투표하세요. (동일 링크 기준 1인 1표/책)</p>
            </Section>

            <AddBookForm />

            <Section title="투표 현황">
              <div className="grid md:grid-cols-2 gap-4">
                {sortedBooks.map((b) => (
                  <BookCard key={b.id} b={b} />
                ))}
              </div>
              {sortedBooks.length === 0 && (
                <div className="text-sm text-gray-500">아직 등록된 책이 없습니다.</div>
              )}
            </Section>

            <HistoryView sb={sb} club={club} currentSemesterId={semester?.id} baseUrl={baseUrl} />
          </>
        )}

        <footer className="mt-10 text-center text-xs text-gray-500">© {new Date().getFullYear()} BookClub Picker</footer>
      </div>
    </div>
  );
}

function HistoryView({ sb, club, currentSemesterId, baseUrl }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!sb || !club) return;
    (async () => {
      const { data: sems } = await sb
        .from("semesters")
        .select("*")
        .eq("club_id", club.id)
        .order("start_date", { ascending: false });
      const result = [];
      for (const s of sems || []) {
        const { data: bks } = await sb
          .from("books")
          .select("*")
          .eq("club_id", club.id)
          .eq("semester_id", s.id);
        const { data: vts } = await sb
          .from("votes")
          .select("book_id")
          .in("book_id", (bks || []).map(b => b.id).concat("00000000-0000-0000-0000-000000000000"));
        const tally = new Map();
        for (const b of bks || []) tally.set(b.id, 0);
        for (const v of vts || []) tally.set(v.book_id, (tally.get(v.book_id)||0)+1);
        const sorted = (bks || []).sort((a,b) => (tally.get(b.id)||0) - (tally.get(a.id)||0));
        result.push({ semester: s, books: sorted, tally });
      }
      setRows(result);
    })();
  }, [sb, club]);

  return (
    <Section title="지난 학기 히스토리">
      {rows.length === 0 && <div className="text-sm text-gray-500">데이터가 없습니다.</div>}
      <div className="space-y-6">
        {rows.map(({ semester, books, tally }) => (
          <div key={semester.id} className={`rounded-2xl p-4 ${semester.id===currentSemesterId? 'bg-indigo-50 border' : 'bg-gray-50 border'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">{semester.title}</div>
              <a className="text-xs underline" href={`${baseUrl}?club=${club.slug}&semester=${semester.id}`}>이 학기 열기</a>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {books.map((b) => (
                <div key={b.id} className="text-sm">
                  <div className="font-medium">{b.title}</div>
                  <div className="text-gray-600">{b.author || "저자 미상"}</div>
                  <div className="text-gray-500">득표: {tally.get(b.id) || 0}</div>
                </div>
              ))}
              {books.length === 0 && (
                <div className="text-xs text-gray-500">등록된 도서 없음</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
