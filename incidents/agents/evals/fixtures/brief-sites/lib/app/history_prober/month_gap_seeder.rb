module App
  module HistoryProber
    class MonthGapSeeder
      def initialize(store)
        @store = store
      end

      def seed(symbol, from, to)
        cursor = from
        until cursor > to
          @store.insert_gap(symbol, cursor) unless @store.covered?(symbol, cursor)
          cursor = (cursor % 100 == 12) ? cursor + 89 : cursor + 1
        end
      end
    end
  end
end
