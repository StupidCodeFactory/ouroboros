module App
  module Web
    class API < Roda
      route do |r|
        r.post "gaps/backfill" do
          GapBackfill.enqueue(r.params["symbol"])
          { ok: true }
        end
      end
    end
  end
end
