module App
  module ApiClients
    module Coingecko
      class API
        def prices(symbol)
          slot_wait
          get("/coins/#{symbol}/market_chart")
        end

        def slot_wait
          RateLimiter.acquire(:coingecko)
        end
      end
    end
  end
end
