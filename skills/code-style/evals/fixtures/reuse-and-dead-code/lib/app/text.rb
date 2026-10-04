module App
  module Text
    def self.blank_to_nil(value)
      value.nil? || value.to_s.strip.empty? ? nil : value
    end
  end
end
