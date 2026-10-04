module App
  module Cli
    class BackfillPrices
      def run(symbols)
        api = ApiClients::Coingecko::API.new
        symbols.each do |symbol|
          api.slot_wait
          Store.write(symbol, api.get_raw(symbol))
        end
      end
    end
  end
end
