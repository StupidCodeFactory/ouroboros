module App
  module Backfill
    class Runner
      def each_month(from, to)
        month = from
        while month <= to
          yield month
          month = next_month(month)
        end
      end

      def next_month(month)
        (month % 100 == 12) ? month + 89 : month + 1
      end
    end
  end
end
