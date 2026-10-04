module App
  module HistoryProber
    class MonthWalker
      def walk(from, to)
        month = from
        while month <= to
          yield month
          month = (month % 100 == 12) ? month + 89 : month + 1
        end
      end
    end
  end
end
