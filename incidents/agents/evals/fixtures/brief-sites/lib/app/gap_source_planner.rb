module App
  class GapSourcePlanner
    def months(from, to)
      result = []
      month = from
      while month <= to
        result << month
        month = (month % 100 == 12) ? month + 89 : month + 1
      end
      result
    end
  end
end
