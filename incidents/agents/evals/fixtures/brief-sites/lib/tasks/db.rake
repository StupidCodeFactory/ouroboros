namespace :db do
  task :backfill_gaps do
    Sync do
      App::Backfill::Runner.new.each_month(202401, 202412) { |month| App::GapBackfill.run(month) }
    end
  end
end
