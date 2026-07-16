select
  (select count(*) from tasks t left join projects p on p.id = t.project_id where p.id is null),
  (select count(*) from assignments a left join tasks t on t.id = a.task_id where t.id is null or t.project_id <> a.project_id),
  (select count(*) from comments c left join tasks t on t.id = c.task_id where t.id is null or t.project_id <> c.project_id),
  (select count(*) from meetings m left join tasks t on t.id = m.hub_task_id where m.hub_task_id is not null and t.id is null),
  (select count(*) from memberships m left join users u on u.id = m.user_id left join workspaces w on w.id = m.workspace_id where u.id is null or w.id is null),
  (select count(*) from project_members pm left join users u on u.id = pm.user_id left join projects p on p.id = pm.project_id where u.id is null or p.id is null),
  (
    select count(*) from (
      select pm.id
      from project_members pm
      join projects p on p.id = pm.project_id
      left join memberships m on m.user_id = pm.user_id and m.workspace_id = p.workspace_id
      where m.id is null
      union all
      select p.id
      from projects p
      left join memberships m on m.user_id = p.owner_id and m.workspace_id = p.workspace_id
      where p.owner_id is not null and m.id is null
    ) access_scope_violations
  ),
  (
    select count(*)
    from assignments a
    join tasks t on t.id = a.task_id
    join projects p on p.id = t.project_id
    left join memberships m on m.user_id = a.user_id and m.workspace_id = p.workspace_id
    where m.id is null
  ),
  (
    select count(*)
    from tasks child
    left join tasks parent on parent.id = child.parent_id
    where child.parent_id is not null and (parent.id is null or parent.project_id <> child.project_id)
  ),
  (
    select count(*)
    from tasks t
    join projects p on p.id = t.project_id
    left join meetings m on m.id::text = t.meeting_id
    where t.meeting_id is not null and (
      m.id is null
      or m.workspace_id <> p.workspace_id
      or (t.kind = 'meeting' and m.hub_task_id is distinct from t.id)
    )
  ),
  (
    select count(*) from (
      select ap.id
      from availability_profiles ap
      left join memberships m on m.user_id = ap.user_id and m.workspace_id = ap.workspace_id
      where m.id is null
      union all
      select ab.id
      from availability_blocks ab
      left join memberships m on m.user_id = ab.user_id and m.workspace_id = ab.workspace_id
      where m.id is null
      union all
      select ato.id
      from availability_task_overrides ato
      join tasks t on t.id = ato.task_id
      join projects p on p.id = t.project_id
      where p.workspace_id <> ato.workspace_id
    ) availability_scope_violations
  ),
  (
    select count(*) from (
      select bp.id
      from booking_pages bp
      join projects p on p.id = bp.project_id
      where p.workspace_id <> bp.workspace_id
      union all
      select bpp.id
      from booking_page_participants bpp
      left join project_members pm on pm.project_id = bpp.project_id and pm.user_id = bpp.user_id
      where pm.id is null
      union all
      select br.id
      from booking_reservations br
      join booking_pages bp on bp.id = br.page_id
      left join tasks t on t.id = br.hub_task_id
      left join meetings m on m.id = br.meeting_id
      where bp.project_id <> br.project_id
        or ((br.hub_task_id is null) <> (br.meeting_id is null))
        or (br.hub_task_id is not null and (
          t.id is null
          or m.id is null
          or t.project_id <> br.project_id
          or t.meeting_id is distinct from br.meeting_id::text
          or m.hub_task_id is distinct from t.id
        ))
    ) booking_scope_violations
  ),
  (
    select count(*)
    from intake_submissions s
    left join tasks t on t.id = s.task_id
    where s.task_id is not null and (t.id is null or t.project_id <> s.project_id)
  ),
  (select count(*) from drizzle.__drizzle_migrations),
  (select count(*) from users),
  (select count(*) from tasks);
